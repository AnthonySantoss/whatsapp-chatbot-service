import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';

import { PrimaryPointConnector } from './connectors/primary-point.connector.js';
import { SessionManager } from './core/session-manager.js';
import { DialogEngine } from './core/dialog-engine.js';
import { EvolutionProvider } from './providers/evolution.provider.js';

const app = Fastify({
  bodyLimit: 50 * 1024 * 1024,
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Registrar CORS
await app.register(cors, {
  origin: true,
});

// Inicialização dos serviços
const sessionManager = new SessionManager(60);
const primaryPointConnector = new PrimaryPointConnector();
const dialogEngine = new DialogEngine(sessionManager, primaryPointConnector);
const evolutionProvider = new EvolutionProvider();

// Rota de Healthcheck
app.get('/health', async (request, reply) => {
  return reply.send({
    status: 'ok',
    service: 'whatsapp-chatbot-service',
    systemConnector: primaryPointConnector.systemName,
    activeSessions: sessionManager.getActiveSessionsCount(),
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Schema Zod para simulação direta (facilita testes e depuração)
const SimulateSchema = z.object({
  phone: z.string().min(1),
  text: z.string().default(''),
});

// Rota de teste/simulação direta sem depender da Evolution API
app.post('/simulate', async (request, reply) => {
  const parseResult = SimulateSchema.safeParse(request.body);
  if (!parseResult.success) {
    return reply.status(400).send({
      error: 'Invalid request body',
      details: parseResult.error.errors,
    });
  }

  const { phone, text } = parseResult.data;
  const replyText = await dialogEngine.processMessage({
    senderPhone: phone,
    messageText: text,
  });

  return reply.send({
    senderPhone: phone,
    input: text,
    reply: replyText,
    sessionState: sessionManager.getSession(phone).state,
  });
});

// Rota de Webhook da Evolution API v2
app.post('/webhook/evolution', async (request, reply) => {
  const body = request.body as Record<string, any>;

  // Validação básica do payload
  if (!body) {
    return reply.status(400).send({ error: 'Empty payload' });
  }

  // Identificação do evento
  const event = body.event || body.type;
  app.log.debug({ event }, 'Evolution webhook received');

  // Processamos apenas eventos de mensagens recebidas
  if (event && event !== 'messages.upsert') {
    return reply.send({ received: true, ignored: true, reason: `Unprocessed event: ${event}` });
  }

  const messageData = body.data || body;
  const key = messageData.key || {};

  // Ignorar mensagens enviadas pelo próprio bot
  if (key.fromMe === true) {
    return reply.send({ received: true, ignored: true, reason: 'fromMe is true' });
  }

  const remoteJid = key.remoteJid || '';

  // Ignorar mensagens de grupos ou status broadcast
  if (remoteJid.includes('@g.us') || remoteJid.includes('status@broadcast')) {
    return reply.send({ received: true, ignored: true, reason: 'Group or broadcast message' });
  }

  // Extrair o número do remetente
  const senderPhone = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
  if (!senderPhone) {
    return reply.send({ received: true, ignored: true, reason: 'No valid sender phone' });
  }

  // Extrair o texto da mensagem
  const messageObj = messageData.message || {};
  const messageText =
    messageObj.conversation ||
    messageObj.extendedTextMessage?.text ||
    messageObj.buttonsResponseMessage?.selectedDisplayText ||
    messageObj.listResponseMessage?.singleSelectReply?.selectedRowId ||
    '';

  app.log.info(
    { senderPhone, messagePreview: messageText.substring(0, 30) },
    'Processing WhatsApp message'
  );

  try {
    const responseText = await dialogEngine.processMessage({
      senderPhone,
      messageText,
    });

    if (responseText) {
      const sendResult = await evolutionProvider.sendTextMessage(senderPhone, responseText);
      if (!sendResult.success) {
        app.log.error(
          { error: sendResult.error, senderPhone },
          'Failed to send response via Evolution API'
        );
      }
    }

    return reply.send({ received: true, processed: true });
  } catch (error) {
    app.log.error({ error, senderPhone }, 'Error in dialog engine execution');
    return reply.status(500).send({
      received: true,
      error: error instanceof Error ? error.message : 'Internal error processing message',
    });
  }
});

// Inicialização do servidor
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const start = async () => {
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`🤖 WhatsApp Chatbot Service running on http://${HOST}:${PORT}`);
    app.log.info(`📡 Primary Point Connector pointing to: ${process.env.PRIMARY_POINT_API_URL || 'default'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  app.log.info('Shutting down server gracefully...');
  sessionManager.destroy();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
