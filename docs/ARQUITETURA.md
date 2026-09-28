# Arquitetura

## Visão geral

```
┌─────────────────────────┐   /api (JSON, Bearer JWT)   ┌──────────────────────────────────┐
│ apps/web (React/Vite)   │ ──────────────────────────▶ │ apps/api (Express 5)             │
│ TanStack Query          │                             │  middleware: helmet · cors ·     │
│ seletor global de loja  │                             │  authenticate · requirePermission│
└──────────┬──────────────┘                             │  módulos → serviços → Drizzle    │
           │                                            └───────────────┬──────────────────┘
           │   packages/shared (permissões, status da OS, enums)        │
           └────────────────────────────┬───────────────────────────────┘
                                        ▼
                               PostgreSQL 16 (constraints, locks, kardex)
```

## Ciclo de uma requisição

1. `authenticate` valida o JWT e carrega **usuário + cargo + permissões** do banco (mudanças valem na hora; usuário inativo ou de loja inativa perde o acesso).
2. `requirePermission('modulo.acao')` / `requireAnyPermission(...)` barram quem não tem a ação.
3. A rota valida entrada com Zod e resolve o **escopo de loja** (`resolveReadScope` / `resolveWriteStore` / `assertStoreAccess`).
4. O serviço executa a regra de negócio em uma transação; estoque passa sempre por `applyStockChanges`.
5. O `errorHandler` traduz `AppError`, `ZodError` e erros do Postgres (unique → 409 com mensagem amigável, CHECK de estoque → 409 `INSUFFICIENT_STOCK`).

## Modelo de dados

```
stores ─┬─< users >── roles ──< role_permissions
        │
        ├─< stock_levels >── products            (saldo por loja; CHECK quantity >= 0)
        ├─< stock_movements >── products         (kardex imutável: tipo, delta, saldo, origem)
        ├─< service_orders ──< service_order_items >── products
        │        │      └──< service_order_history
        │        └── customers
        ├─< sales ──< sale_items >── products
        │     └──< sale_payments
        └─< stock_transfers (from/to) ──< stock_transfer_items >── products

counters (numeração atômica por escopo)  ·  import_jobs (histórico de importações)
```

| Tabela | Escopo | Pontos relevantes |
|---|---|---|
| `stores` | rede | `code` curto usado na numeração (`LJ01-00042`) e nas colunas da planilha |
| `roles` / `role_permissions` | rede | `scope` GLOBAL/STORE; `is_system` = Administrador (acesso total, imutável) |
| `users` | loja | `store_id` obrigatório para cargos STORE; nunca apagados (histórico), só desativados |
| `customers` | rede | CPF/CNPJ único (índice parcial) — cadastro rápido na OS reaproveita |
| `products` | rede | SKU único; EAN único (índice parcial); preços em centavos |
| `stock_levels` | loja | PK `(store_id, product_id)`; `CHECK quantity >= 0` |
| `stock_movements` | loja | `type` (IMPORT, ADJUSTMENT, SALE, SALE_CANCEL, SERVICE_ORDER, SERVICE_ORDER_REVERSAL, TRANSFER_OUT/IN/RETURN), `quantity` com sinal, `balance_after`, referência |
| `service_orders` | loja | número único por loja; totais; `stock_deducted` espelha o invariante de estoque |
| `sales` | loja | número único por loja; pagamentos múltiplos; troco; cancelamento com motivo |
| `stock_transfers` | 2 lojas | `CHECK from <> to`; IN_TRANSIT → RECEIVED / CANCELLED |
| `import_jobs` | rede | contagens, erros/avisos (jsonb), duração |

Itens de venda e de OS **congelam** descrição, preço e custo — relatórios de margem não mudam quando o cadastro muda.

## Cargos de exemplo (seed)

| Permissão | Administrador | Supervisor de Rede | Gerente | Técnico | Vendedor |
|---|:-:|:-:|:-:|:-:|:-:|
| Alcance | todas | todas | própria | própria | própria |
| Dashboard | ✔ | ✔ | ✔ | | |
| OS: ver/criar/editar/status | ✔ | ver | ✔ | ✔ | ver/criar |
| OS: excluir | ✔ | | ✔ | | |
| PDV: vender / cancelar | ✔ | ver | ✔ / ✔ | | ✔ / — |
| Clientes | ✔ | ver | ver/criar/editar | (via OS) | ver/criar/editar |
| Produtos | ✔ | ver | ver/criar/editar | (busca na OS) | ver |
| Estoque: ver / ajustar | ✔ | ver | ✔ / ✔ | | ver |
| Transferências | ✔ | ver/enviar/receber | ✔ | | |
| Importação | ✔ | histórico | histórico | | |
| Usuários | ✔ | ver | ✔ (própria loja) | | |
| Cargos · Lojas | ✔ | lojas: ver | | | |

Todos editáveis pela tela **Cargos e permissões** (exceto o Administrador).

## Concorrência

| Recurso | Mecanismo |
|---|---|
| Saldo de estoque | `SELECT … FOR UPDATE` ordenado por (loja, produto) + `CHECK >= 0` |
| Status da OS / cancelamento de venda / transferência | `SELECT … FOR UPDATE` na linha do documento |
| Numeração de OS, vendas e transferências | `INSERT … ON CONFLICT DO UPDATE value = value + 1 RETURNING` (lock até o commit) |
| Importação | `pg_advisory_xact_lock` + `ON CONFLICT (sku) DO NOTHING` com verificação da contagem inserida |

## Escalabilidade

- Stateless: a API escala horizontalmente atrás de um balanceador (JWT; nenhum estado em memória).
- Consultas de listagem paginadas e indexadas por `(store_id, created_at)` / `(store_id, status)`.
- Dashboard em agregações SQL paralelas; para anos de histórico, mover para views materializadas atualizadas por agendamento.
- Importação síncrona suporta dezenas de milhares de linhas; acima disso, o serviço já isolado pode ir para um worker com fila.
