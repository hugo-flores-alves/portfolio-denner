# Importação em massa de produtos

Guia para o setup inicial do inventário (1.000+ peças) e para cargas posteriores. Disponível no painel em **Estoque › Importação**, pela API (`POST /api/imports/products`) e pela linha de comando (`npm run import:products`). As três usam o mesmo serviço.

## 1. Formato da planilha

Aceita **.xlsx** (primeira aba visível) ou **.csv/.txt** (separador `;`, `,`, tab ou `|`, detectado pelo cabeçalho; UTF-8 ou Windows-1252). Uma linha por produto; a primeira linha é o cabeçalho.

Baixe o modelo pronto (já com uma coluna por loja ativa) no painel ou em `GET /api/imports/products/template?format=xlsx`.

| Campo | Obrigatório | Cabeçalhos aceitos (sem acento/maiúsculas) | Observações |
|---|---|---|---|
| SKU | **sim** | `sku`, `codigo`, `cod`, `codigo_interno`, `referencia`, `ref` | Único na rede. Normalizado: maiúsculas, espaços nas pontas removidos. |
| Nome | **sim** | `nome`, `produto`, `nome_produto`, `descricao`* | *`descricao` só vira nome se não houver coluna de nome. |
| Código de barras | não | `codigo_barras`, `codigo_de_barras`, `ean`, `gtin`, `barcode` | Único na rede. No Excel, formate a coluna como **Texto**. |
| Descrição | não | `descricao`, `detalhes`, `observacao` | |
| Categoria | não | `categoria`, `grupo`, `tipo` | |
| Marca | não | `marca`, `fabricante` | |
| Modelos compatíveis | não | `modelos_compativeis`, `compatibilidade`, `modelo`, `aparelho` | Texto livre (ex.: `iPhone 11, iPhone 11 Pro`). |
| Preço de custo | não | `preco_custo`, `custo`, `valor_custo` | `12,50` · `1.234,56` · `1234.56` · `R$ 12,50` |
| Preço de venda | não | `preco_venda`, `preco`, `valor`, `valor_venda` | idem |
| Estoque mínimo | não | `estoque_minimo`, `minimo`, `qtd_minima` | Alerta de reposição por loja. |

### Estoque inicial por loja

Uma coluna por loja: prefixo `estoque_`, `qtd_`, `quantidade_` ou `saldo_` + **código** ou **nome** da loja.

```
sku;nome;preco_venda;estoque_LJ01;estoque_LJ02;estoque_LJ03
TELA-IP11-INC;Tela Frontal iPhone 11 Incell;289,90;3;6;
BAT-SM-A12;Bateria Samsung Galaxy A12;119,90;5;;1
```

- **Célula vazia = não altera** o saldo daquela loja (diferente de `0`, que zera).
- `Qtd Loja Centro` e `estoque_LJ01` são equivalentes se a loja LJ01 se chama "Loja Centro".
- Alternativa para planilhas de uma loja só: uma coluna `quantidade` + escolher a **loja padrão** no envio (`defaultStoreId` / `--default-store LJ01`). Não misture os dois formatos.
- Uma coluna de estoque que não corresponde a nenhuma loja ativa **bloqueia** a importação (evita lançar saldo no lugar errado por erro de digitação).

## 2. Opções

| Opção | Valores | Padrão | Efeito |
|---|---|---|---|
| `mode` | `UPSERT` · `CREATE_ONLY` | `UPSERT` | SKU já cadastrado: atualiza (células vazias mantêm o valor atual) ou ignora. |
| `stockMode` | `SET` · `ADD` | `SET` | `SET`: a planilha é a contagem oficial — **reimportar o mesmo arquivo não duplica estoque**. `ADD`: soma ao saldo (entrada de mercadoria). |
| `dryRun` | `true`/`false` | `false` | Só valida e devolve o relatório. |
| `strict` | `true`/`false` | `false` | Qualquer erro cancela tudo (HTTP 422). Sem ele, linhas inválidas são puladas e as válidas importadas. |
| `defaultStoreId` | UUID da loja | — | Loja da coluna única `quantidade`. |

Fluxo recomendado para o setup inicial: **validar (dry-run) → corrigir a planilha → validar de novo → importar**. Como `UPSERT` + `SET` é idempotente, dá para reimportar a planilha corrigida inteira sem medo.

## 3. Validações e mensagens

| Situação | Tipo | Mensagem |
|---|---|---|
| SKU vazio | erro | SKU obrigatório |
| SKU repetido no arquivo (inclusive `abc` × `ABC`) | erro em **todas** as ocorrências | SKU repetido no arquivo (linhas 12, 57) |
| Código de barras repetido no arquivo | erro em todas as ocorrências | Código de barras repetido no arquivo (linhas 4, 5) |
| Código de barras já pertence a outro SKU | erro | Código de barras já cadastrado no produto SKU X |
| `7,89E+12` na coluna de EAN | erro | Código de barras em notação científica — formate a coluna como Texto e exporte novamente |
| Preço inválido / negativo / acima de R$ 1 mi | erro | Valor monetário inválido |
| Quantidade não inteira / negativa | erro | Quantidade deve ser um número inteiro |
| Dígito verificador de EAN-8/12/13/14 não confere | aviso | Dígito verificador do EAN/GTIN não confere |
| Preço de venda abaixo do custo | aviso | Preço de venda abaixo do custo |
| SKU existente em `CREATE_ONLY` | aviso | SKU já cadastrado — ignorado |
| Coluna não reconhecida | aviso | Coluna "X" ignorada |

O painel permite baixar erros e avisos em CSV (linha, campo, valor, mensagem) para corrigir a planilha.

## 4. Como a gravação funciona

1. Toda a validação acontece antes de qualquer escrita.
2. Uma única transação com `pg_advisory_xact_lock` (duas importações nunca rodam em paralelo); a classificação criar/atualizar é refeita dentro dela.
3. Inserção em lotes de 500 (`INSERT … ON CONFLICT (sku) DO NOTHING RETURNING`), atualização em lote via `UPDATE … FROM (VALUES …)` com `coalesce` (vazio mantém o valor).
4. Saldos: linhas de estoque travadas, valor final calculado (SET/ADD) e gravado em lote; cada diferença gera um movimento `IMPORT` no kardex com referência ao job.
5. O job (arquivo, usuário, contagens, até 1.000 erros/avisos, duração) fica em `import_jobs`. Uma falha inesperada reverte tudo e é registrada como `FAILED`.

Limites (configuráveis em `.env`): `IMPORT_MAX_FILE_MB=15`, `IMPORT_MAX_ROWS=50000`.

## 5. Permissões

- `imports.execute` para importar; `imports.view` para histórico e modelo.
- Usuário de cargo **STORE** só pode lançar estoque na própria loja: colunas de outras lojas bloqueiam a importação (403).

## 6. Planilha de exemplo

`samples/inventario-exemplo.csv` — 1.227 peças realistas (telas, baterias, conectores, câmeras, películas, capinhas, carregadores…) com EAN-13 válidos e saldo nas 3 lojas. Gerada de forma determinística por `npm run sample:inventory -w @erp/api`.
