# WhatsApp Chatbot Service 🤖

Microserviço autônomo e extensível para automação de atendimento e reservas via WhatsApp, construído com **Node.js 20+**, **TypeScript**, **Fastify** e integrado à **Evolution API v2**.

---

## 🏛 Arquitetura e Padrão Conectores (Adapter Pattern)

O microserviço adota uma arquitetura desacoplada onde o motor de diálogo (`DialogEngine`) e o gerenciador de sessões (`SessionManager`) são completamente independentes do sistema de gestão de reservas de destino.

A comunicação com o sistema de agendamento é feita através da interface de contrato `ExternalSystemConnector`:

```typescript
export interface ExternalSystemConnector {
  readonly systemName: string;
  requestOtp(phone: string, email: string): Promise<{ success: boolean; message: string }>;
  verifyOtp(phone: string, code: string): Promise<{ success: boolean; user?: AuthenticatedUser; message: string }>;
  getAvailableSpaces(date?: string): Promise<SpaceItem[]>;
  createQuickBooking(phone: string, spaceId: string, eventName: string, date: string, startHour: string, endHour: string): Promise<{ success: boolean; bookingId?: string; message: string }>;
}
```

- **`PrimaryPointConnector`**: Conector padrão implementado para comunicação com a API do monolito **Nassau Espaços** (`primary-point`).
- Novos sistemas podem ser plugados facilmente criando uma classe que implemente `ExternalSystemConnector`.

---

## 🔄 Fluxo de Conversação e Máquina de Estados

O bot implementa uma máquina de estados finitos em memória com TTL de 60 minutos por sessão:

```
[Qualquer Mensagem]
        │
        ▼
[UNAUTHENTICATED] ── Solicita e-mail institucional (@uninassau.edu.br)
        │
        ▼
[AWAITING_EMAIL] ── Valida formato e solicita OTP via Primary Point API
        │
        ▼
[AWAITING_OTP] ── Valida código de 6 dígitos numéricos
        │
        ▼
[AUTHENTICATED] ── Menu Principal
        ├─ [1] Consultar salas livres hoje
        ├─ [2] Fazer reserva rápida ──► [SELECTING_DATE] ──► [SELECTING_SPACE] ──► [CONFIRMING_BOOKING]
        ├─ [3] Meus agendamentos (Link para o portal web)
        └─ [4] Sair (Reseta a sessão)
```

Comandos universais disponíveis a qualquer momento:
- `sair`, `logout`: finaliza a sessão.
- `cancelar`, `menu`, `voltar`: retorna ao menu principal (se autenticado).

---

## 🚀 Como Executar

### Pré-requisitos
- Docker e Docker Compose instalados.
- Rede Docker `agendador-dev_default` ativa (gerada pela stack do `primary-point`).

### 1. Inicialização Completa com Docker Compose

Suba a Evolution API v2 e o microserviço do chatbot com um único comando:

```bash
docker compose up -d --build
```

Verifique os logs:
```bash
docker compose logs -f whatsapp-chatbot
```

### 2. Conectando o WhatsApp na Evolution API

1. Acesse o painel da Evolution API no navegador:
   ```
   http://localhost:8086
   ```
2. Crie ou acesse a instância configurada (`nassau-bot`) informando a API Key global (`evolution-local-secret-2026`).
3. Gere o QR Code e escaneie com o WhatsApp do número institucional/atendente.
4. O webhook já está pré-configurado no `docker-compose.yml` para apontar diretamente para:
   ```
   http://whatsapp-chatbot:3001/webhook/evolution
   ```

### 3. Execução em Modo de Desenvolvimento Local (sem Docker para o bot)

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Ajuste o `.env` se for rodar fora da rede Docker:
   ```env
   PRIMARY_POINT_API_URL=http://localhost:3000/api/v1/integrations/whatsapp
   EVOLUTION_API_URL=http://localhost:8086
   ```

3. Inicie o servidor em modo watch:
   ```bash
   npm run dev
   ```

---

## 🧪 Rotas e Testes sem WhatsApp Físico

O microserviço inclui rotas dedicadas para testes e healthcheck:

### `GET /health`
Verifica a integridade do serviço, conector ativo e contagem de sessões ativas:
```bash
curl http://localhost:3001/health
```

### `POST /simulate`
Permite simular o envio de mensagens de um usuário diretamente pela API REST, sem precisar disparar mensagens reais no WhatsApp:

```bash
# 1. Iniciar conversa
curl -X POST http://localhost:3001/simulate \
  -H "Content-Type: application/json" \
  -d '{"phone": "5579999999999", "text": "Olá"}'

# 2. Informar e-mail institucional
curl -X POST http://localhost:3001/simulate \
  -H "Content-Type: application/json" \
  -d '{"phone": "5579999999999", "text": "professor@uninassau.edu.br"}'

# 3. Informar código OTP
curl -X POST http://localhost:3001/simulate \
  -H "Content-Type: application/json" \
  -d '{"phone": "5579999999999", "text": "123456"}'

# 4. Navegar no menu
curl -X POST http://localhost:3001/simulate \
  -H "Content-Type: application/json" \
  -d '{"phone": "5579999999999", "text": "1"}'
```

---

## 🔒 Segurança e Comunicação M2M

A integração com o monolito `primary-point` utiliza autenticação Machine-to-Machine através do cabeçalho HTTP:
- `x-service-token: local-dev-bot-token-2026`

Garantindo que apenas o microserviço autorizado execute requisições de geração de OTP e agendamento rápido em nome de usuários.
