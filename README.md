# ERP Assistência Técnica — rede multi-loja

ERP para uma rede de assistência técnica de celulares e venda de peças com **3 lojas físicas**: painel administrativo unificado para o dono (todas as lojas somadas ou filtradas) e operação diária isolada por loja.

| Módulo | O que faz |
|---|---|
| **Multi-loja** | Toda tabela operacional (OS, vendas, estoque, movimentações, usuários) carrega `store_id`. Catálogo de produtos e clientes são da rede. |
| **RBAC dinâmico** | Cargos criados pelo dono com matriz **tela × ação** (ver, criar, editar, excluir + ações específicas) e alcance **GLOBAL** (todas as lojas) ou **STORE** (só a própria). |
| **Orçamentos / OS** | Cliente, aparelho, defeito, peças, mão de obra, desconto. Status com transições validadas; **finalizar a OS baixa as peças do estoque da loja automaticamente**. |
| **Estoque** | Saldo por loja + kardex imutável, ajustes, alerta de estoque mínimo e **transferência entre lojas** (envio → em trânsito → recebimento). |
| **PDV** | Venda rápida de balcão (capinhas, carregadores, peças avulsas) com leitor de código de barras, pagamento dividido e troco. |
| **Importação em massa** | CSV/Excel com **1.000+ peças**: validação por linha, SKU/EAN repetidos (no arquivo e no banco), pré-visualização, gravação em lote e **distribuição da quantidade inicial por loja**. |
| **Dashboard** | Faturamento, lucro bruto, ticket médio, OS por status, valor em estoque, reposição — consolidado ou por loja, com comparativo entre filiais. |

---

## Sumário

- [Início rápido](#início-rápido)
- [Usuários de demonstração](#usuários-de-demonstração)
- [Arquitetura](#arquitetura)
- [Decisões de projeto](#decisões-de-projeto)
- [Importação em massa](#importação-em-massa)
- [API](#api)
- [Testes e qualidade](#testes-e-qualidade)
- [Próximos passos](#próximos-passos)

Documentos complementares: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) · [`docs/IMPORTACAO.md`](docs/IMPORTACAO.md)

---

## Início rápido

**Requisitos:** Node.js ≥ 20.10 e PostgreSQL 16 (ou Docker).

```bash
# 1. Banco (cria erp_dev e erp_test)
docker compose up -d

# 2. Dependências e variáveis de ambiente
npm install
cp apps/api/.env.example apps/api/.env      # ajuste JWT_SECRET

# 3. Schema + dados de demonstração
npm run db:migrate
npm run db:seed          # 3 lojas, cargos, usuários, 1.227 peças importadas, OS e vendas

# 4. API (http://localhost:3333) + painel (http://localhost:5173)
npm run dev
```

`npm run db:reset` recria o banco do zero (bloqueado em produção). `npm run db:seed -- --no-demo` cria só lojas, cargos e usuários.

**Produção:** `npm run build` gera `apps/api/dist` (bundle Node ESM: `server.js`, `migrate.js`, `seed.js`, `import-products.js`) e `apps/web/dist` (estático — sirva atrás do mesmo domínio com `/api` apontando para a API).

### Portas e conflito com outros projetos

| Serviço | Porta padrão | Como trocar |
|---|---|---|
| Painel (Vite) | 5173 | `WEB_PORT=5174` em `apps/web/.env` (modelo: `apps/web/.env.example`) |
| API | 3333 | `PORT=3334` em `apps/api/.env` — o painel lê esse mesmo arquivo e acompanha sozinho |
| PostgreSQL (Docker) | 5432 | `DB_PORT=5433 docker compose up -d` **e** a mesma porta no `DATABASE_URL` de `apps/api/.env` |

Se `localhost` abrir **outro projeto**, alguma dessas portas já está ocupada na sua máquina. Em vez de trocar de porta em silêncio, o sistema recusa subir e diz qual porta está em uso (`Port 5173 is already in use` / `A porta 3333 já está em uso`). Encerre o outro projeto ou troque a porta conforme a tabela e rode `npm run dev` de novo.

Se a página continuar mostrando o outro projeto mesmo na porta certa, o navegador está usando cache ou service worker daquele projeto. Recarregue com `Ctrl+Shift+R` ou limpe os dados do site em DevTools → Application → Clear site data.

Problemas de banco na primeira instalação aparecem na tela de login com a ação a tomar, como "Verifique se o PostgreSQL está rodando" ou "rode npm run db:migrate", em vez de "erro interno".

### Publicação (Vercel + Supabase)

O deploy de produção usa a **Build Output API** do Vercel (`npm run build:vercel` → `scripts/build-vercel.mjs`):

| Saída | Conteúdo |
|---|---|
| `.vercel/output/static` | painel React |
| `.vercel/output/functions/api.func` | API Express empacotada num arquivo (região `gru1`, São Paulo) |
| `.vercel/output/config.json` | `/api/*` → função; demais rotas → `index.html` |

O projeto Vercel fica ligado ao GitHub: **todo merge na `main` publica automaticamente**. A instalação usa `npm ci --include=dev`, porque com `NODE_ENV=production` o npm pularia as ferramentas de build.

Variáveis de ambiente no Vercel:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | pooler do Supabase em modo transação (porta 6543), com o usuário `erp_app.<ref>` e `?sslmode=no-verify` |
| `JWT_SECRET` | valor aleatório longo |
| `NODE_ENV` | `production` |
| `DB_POOL_MAX` | `3` (poucas conexões por instância; o pooler multiplexa) |
| `IMPORT_MAX_FILE_MB` | `4` (limite de corpo das funções do Vercel: 4,5 MB) |

**Banco:** o schema é aplicado a partir de `apps/api/drizzle/`. A aplicação conecta com um usuário próprio (`erp_app`) que só tem permissão de leitura e escrita nas tabelas do ERP. Os papéis `anon` e `authenticated` do Supabase ficam sem acesso às tabelas, e a RLS fica ligada, então a API REST automática do Supabase não expõe os dados. Produção começa sem dados de demonstração: lojas, cargos e um Administrador.

Pendências para quando sair do piloto:
- Planos pagos: Vercel Pro para uso comercial e Supabase Pro para backup diário.
- Validar o certificado do banco (`sslmode=verify-full` com a CA do Supabase).

## Usuários de demonstração

Senha de todos: **`Senha@123`**

| E-mail | Cargo | Alcance |
|---|---|---|
| `admin@erp.local` | Administrador (sistema) | todas as lojas, acesso total |
| `supervisor@erp.local` | Supervisor de Rede | todas as lojas, leitura + transferências |
| `gerente.centro@erp.local` | Gerente | LJ01 — tudo da própria loja |
| `tecnico.centro@erp.local` | Técnico | LJ01 — **somente Orçamentos/OS** |
| `vendedor.centro@erp.local` | Vendedor | LJ01 — PDV, clientes, abertura de orçamento |

Há também gerente/técnico/vendedor para `shopping` (LJ02) e gerente/técnico para `bairro` (LJ03).

---

## Arquitetura

```
.
├── packages/shared      Fonte única de verdade: catálogo de permissões, máquina de
│                        status da OS, enums, dinheiro. Usado pela API e pelo painel.
├── apps/api             Express 5 · TypeScript · Drizzle ORM · PostgreSQL · Zod
│   ├── drizzle/         Migrações SQL versionadas
│   ├── src/db           schema.ts, migrate, seed, reset
│   ├── src/modules      auth · stores · roles · users · customers · products ·
│   │                    inventory · transfers · service-orders · sales ·
│   │                    dashboard · imports · meta
│   ├── src/scripts      import-products (CLI) · generate-sample-inventory
│   └── test             Testes de integração (Vitest + Supertest + Postgres real)
├── apps/web             React 19 · Vite · Tailwind 4 · TanStack Query · React Router
└── samples/             inventario-exemplo.csv (1.227 peças para testar a importação)
```

Cada módulo da API segue `rotas (HTTP + validação Zod) → serviço (regra de negócio + transação) → Drizzle`. Os serviços de estoque, OS, vendas, transferências e importação não conhecem HTTP — são reutilizados pelo seed e pelo CLI.

## Decisões de projeto

### Multi-loja e isolamento
- Catálogo de **produtos** e **clientes** é da rede (o mesmo SKU é transferido entre lojas; o cliente é atendido em qualquer filial). **Estoque** é por `(store_id, product_id)`.
- O escopo é resolvido no servidor a cada requisição (`store-scope.ts`): usuário GLOBAL escolhe "todas" ou uma loja; usuário STORE fica preso à sua loja — pedir outra loja responde **403**, e acessar um registro de outra loja responde **404** (não revela existência).
- Numeração de OS e vendas é **sequencial por loja** (`LJ01-00042`), gerada por contador com lock de linha (sem lacunas nem duplicidade sob concorrência).

### RBAC
- Permissões são chaves `modulo.acao` definidas em `packages/shared/src/permissions.ts`; a API valida qualquer permissão recebida contra o catálogo e o painel monta a matriz a partir dele.
- Usuário, cargo e permissões são carregados **a cada requisição**: mudar um cargo ou desativar alguém tem efeito imediato, sem esperar o token expirar.
- **Anti-escalonamento de privilégio:** quem não é Administrador só concede permissões que possui, só atribui cargos que consegue gerenciar e só cria cargos GLOBAL se tiver acesso global. Um gerente não consegue criar um "super-técnico", nem se promover.
- O cargo **Administrador** é de sistema: acesso total (inclusive a permissões futuras), imutável e não excluível.

### Estoque — consistência
- Toda alteração de saldo passa por `inventory/stock.service.ts`, dentro da transação da operação (venda, OS, transferência, ajuste).
- Linhas são travadas com `SELECT … FOR UPDATE` em **ordem determinística** (loja, produto) para evitar deadlocks; faltas são reportadas **todas de uma vez** (`409 INSUFFICIENT_STOCK` com a lista de peças, disponível e necessário).
- `CHECK (quantity >= 0)` no banco é a última barreira. Detalhe do Postgres que moldou o código: em `INSERT … ON CONFLICT DO UPDATE` o CHECK é avaliado na linha *proposta* antes do conflito — por isso saídas usam `UPDATE` em linhas travadas e só entradas usam upsert.
- Cada variação gera uma linha imutável no **kardex** (`stock_movements`) com saldo resultante, tipo, usuário e documento de origem. Um teste de concorrência prova que duas OS disputando a última peça resultam em exatamente uma conclusão.

### Orçamento → OS → baixa automática

```
AGUARDANDO APROVAÇÃO ─aprovar─▶ EM MANUTENÇÃO ─finalizar─▶ CONCLUÍDO ─▶ ENTREGUE
      │   ▲                          │                         │
      │   └──────── reorçar ─────────┘                         └─ reabrir ─▶ EM MANUTENÇÃO
      ├─▶ REPROVADO ─▶ (reavaliar)                                 (estorna as peças)
      └─▶ CANCELADO
```

Invariante: **peças baixadas ⇔ status ∈ {Concluído, Entregue}**. Entrar nesse conjunto baixa as peças da loja da OS; sair (reabrir) estorna. A flag `stock_deducted` torna a transição idempotente. Após concluir, peças e valores ficam travados; diagnóstico e observações continuam editáveis. Preço e **custo** de cada item são congelados no lançamento, então a margem histórica não muda quando o custo do produto é reajustado.

### Dinheiro
Valores em **centavos inteiros** no banco e na API. O parser aceita o padrão brasileiro (`1.234,56`, `R$ 12,50`, `1.500`) e o internacional (`1234.56`).

## Importação em massa

Pipeline em camadas desacopladas do HTTP (rota e CLI usam o mesmo serviço):

1. **Leitura** — CSV (detecta separador `;` `,` tab e encoding UTF-8 × Windows-1252, padrão do Excel em português) ou XLSX (números continuam números).
2. **Mapeamento de colunas** por apelidos normalizados (`Preço de Venda` = `preco_venda` = `valor`) e colunas de estoque por loja: `estoque_LJ01`, `Qtd Loja Centro`, `saldo_shopping`…
3. **Validação por linha** — obrigatórios, preços, quantidades, código de barras em notação científica (`7,89E+12` truncado pelo Excel), dígito verificador EAN (aviso).
4. **Duplicidades** — SKU/EAN repetidos no arquivo invalidam todas as ocorrências; EAN já cadastrado em outro SKU é rejeitado; SKU existente vira atualização (UPSERT) ou é ignorado (CREATE_ONLY).
5. **Pré-visualização (dry-run)** — relatório completo sem gravar nada.
6. **Gravação em lote** numa única transação: `INSERT … ON CONFLICT` em blocos de 500, `UPDATE … FROM (VALUES …)` para existentes, saldos absolutos por loja + kardex; lock consultivo impede importações simultâneas. Linhas inválidas não bloqueiam as válidas (a menos que `strict`).

**Desempenho medido:** 1.500 peças × 3 lojas em ~0,6 s; a planilha de exemplo (1.227 peças, 3.233 saldos) em ~0,5 s.

```bash
# Pela linha de comando (setup inicial / migração)
npm run import:products -- --file samples/inventario-exemplo.csv --dry-run
npm run import:products -- --file inventario.xlsx --mode UPSERT --stock-mode SET --user admin@erp.local
npm run import:products -- --file estoque-centro.csv --default-store LJ01
```

Formato da planilha, opções e mensagens de erro: [`docs/IMPORTACAO.md`](docs/IMPORTACAO.md).

## API

Base `/api`, JSON, autenticação `Authorization: Bearer <token>`. Erros seguem `{ "error": { "code", "message", "details?" } }`. Listagens aceitam `page`/`pageSize` e retornam `{ data, total, page, pageSize }`. Parâmetro `storeId` filtra por loja (validado contra o escopo do usuário).

| Método e rota | Permissão | Descrição |
|---|---|---|
| `POST /auth/login` · `GET /auth/me` · `POST /auth/change-password` | — | Sessão; `/me` traz permissões efetivas e lojas acessíveis |
| `GET /meta/permissions` | autenticado | Catálogo de permissões (matriz) |
| `GET /dashboard/summary?storeId&from&to` | `dashboard.view` | Indicadores consolidados ou por loja |
| `GET/POST /stores` · `PATCH /stores/:id` | `stores.*` | Lojas (lista básica liberada a todos) |
| `GET/POST /roles` · `GET/PATCH/DELETE /roles/:id` | `roles.*` | Cargos e permissões |
| `GET/POST /users` · `GET/PATCH/DELETE /users/:id` | `users.*` | Usuários (DELETE = desativar) |
| `GET/POST /customers` · `GET/PATCH/DELETE /customers/:id` | `customers.*` | Clientes |
| `GET /products` · `GET /products/lookup/:code` · `POST/PATCH/DELETE` | `products.*` | Catálogo com saldo no escopo; lookup por SKU/EAN |
| `GET /stock/movements` · `POST /stock/adjustments` | `stock.view` / `stock.adjust` | Kardex e ajustes (SET/ADD) |
| `GET/POST /stock-transfers` · `POST /:id/receive` · `POST /:id/cancel` | `stock_transfers.*` | Transferências |
| `GET/POST /service-orders` · `GET/PATCH/DELETE /:id` · `POST /:id/status` | `service_orders.*` | Orçamentos/OS e transições |
| `GET/POST /sales` · `GET /sales/:id` · `POST /:id/cancel` | `sales.*` | PDV e cancelamento com estorno |
| `POST /imports/products` (multipart) | `imports.execute` | Importação (`dryRun`, `mode`, `stockMode`, `strict`, `defaultStoreId`) |
| `GET /imports/products/template?format=xlsx\|csv` | `imports.*` | Modelo com uma coluna por loja ativa |
| `GET /imports` · `GET /imports/:id` | `imports.view` | Histórico |

## Testes e qualidade

```bash
npm test            # 75 testes de integração contra Postgres (banco erp_test)
npm run typecheck   # shared + api + web, strict + noUnused*
npm run build
```

Cobertura por área: autenticação; RBAC e isolamento entre lojas; anti-escalonamento; efeito imediato de mudança de cargo/desativação; fluxo completo da OS com baixa, estorno e reabertura; concorrência na última peça; transferências (enviar/receber/cancelar e permissões por ponta); PDV (troco, pagamento insuficiente, cancelamento); dashboard consolidado × por loja; importação (1.500 linhas, dry-run, idempotência UPSERT+SET, ADD, duplicidades, XLSX com fórmulas, modo estrito, escopo de loja) e unidades dos parsers. O CI (`.github/workflows/ci.yml`) roda typecheck, testes e build a cada push.

Segurança: senhas com scrypt, JWT HS256 com algoritmo fixado, rate limit no login, resposta de login com tempo equalizado (não revela e-mails), Helmet, CORS restrito, validação Zod em toda entrada, SQL parametrizado, upload limitado por tamanho/extensão/linhas.

## Próximos passos

O que eu priorizaria para produção, em ordem:

1. **Sessão:** refresh token rotativo em cookie `httpOnly` + revogação (hoje: JWT de 12 h no `localStorage`; desativação já corta o acesso na hora).
2. **Caixa:** abertura/fechamento por turno com conferência por forma de pagamento (o dashboard já separa dinheiro líquido de troco).
3. **Reserva de peças** na aprovação do orçamento (hoje a checagem de saldo ocorre na conclusão).
4. **Compras e fornecedores** (entrada com NF, custo médio) e **emissão fiscal** (NFC-e/NFS-e) via integrador.
5. **Importações gigantes** (50 mil+ linhas) em fila (BullMQ) — a tabela `import_jobs` e o serviço já estão desacoplados para isso.
6. **Row-Level Security** no Postgres como segunda camada do isolamento por loja; auditoria genérica de alterações.
7. Busca textual com `pg_trgm` quando o catálogo crescer.
