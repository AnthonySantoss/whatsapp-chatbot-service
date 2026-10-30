import { ExternalSystemConnector, SpaceItem } from '../connectors/connector.interface.js';
import { SessionManager, DialogState, UserSession } from './session-manager.js';

export interface ProcessMessageParams {
  senderPhone: string;
  messageText: string;
}

export class DialogEngine {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly connector: ExternalSystemConnector
  ) {}

  public async processMessage(params: ProcessMessageParams): Promise<string> {
    const { senderPhone } = params;
    const rawText = (params.messageText || '').trim();
    const textLower = rawText.toLowerCase();

    const session = this.sessionManager.getSession(senderPhone);

    // Comandos universais de saída / cancelamento
    if (['sair', 'logout', 'desconectar'].includes(textLower)) {
      this.sessionManager.resetSession(senderPhone);
      return '👋 Sua sessão foi encerrada com sucesso. Quando precisar, envie uma mensagem para iniciar novamente!';
    }

    if (['cancelar', 'menu', 'voltar', 'inicio'].includes(textLower) && session.user) {
      this.sessionManager.updateSession(senderPhone, {
        state: 'AUTHENTICATED',
        selectedDate: undefined,
        selectedSpace: undefined,
        availableSpaces: undefined,
        pendingEventName: undefined,
        pendingStartHour: undefined,
        pendingEndHour: undefined,
      });
      return this.renderMainMenu(session.user.fullName);
    }

    // Máquina de estados
    switch (session.state) {
      case 'UNAUTHENTICATED':
        return this.handleUnauthenticated(session, rawText);

      case 'AWAITING_EMAIL':
        return this.handleAwaitingEmail(session, rawText);

      case 'AWAITING_OTP':
        return this.handleAwaitingOtp(session, rawText);

      case 'AUTHENTICATED':
        return this.handleAuthenticated(session, rawText);

      case 'SELECTING_DATE':
        return this.handleSelectingDate(session, rawText);

      case 'SELECTING_SPACE':
        return this.handleSelectingSpace(session, rawText);

      case 'CONFIRMING_BOOKING':
        return this.handleConfirmingBooking(session, rawText);

      default:
        this.sessionManager.resetSession(senderPhone);
        return 'Olá! Sou o assistente virtual do Nassau Espaços. Para começar, informe seu e-mail institucional (@uninassau.edu.br):';
    }
  }

  private handleUnauthenticated(session: UserSession, text: string): string {
    this.sessionManager.updateSession(session.phone, { state: 'AWAITING_EMAIL' });
    return (
      '👋 Olá! Sou o assistente virtual do *Nassau Espaços*.\n\n' +
      'Para acessar o sistema de reservas, por favor informe seu e-mail institucional (@uninassau.edu.br):'
    );
  }

  private async handleAwaitingEmail(session: UserSession, emailText: string): Promise<string> {
    const email = emailText.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return '⚠️ Por favor, informe um endereço de e-mail válido (exemplo: seu.nome@uninassau.edu.br):';
    }

    const otpResponse = await this.connector.requestOtp(session.phone, email);

    if (!otpResponse.success) {
      return (
        `❌ ${otpResponse.message}\n\n` +
        'Por favor, verifique seu e-mail institucional e tente novamente, ou digite "sair" para cancelar.'
      );
    }

    this.sessionManager.updateSession(session.phone, {
      state: 'AWAITING_OTP',
      pendingEmail: email,
    });

    return (
      '✉️ Enviamos um código de 6 dígitos para o seu e-mail:\n' +
      `*${email}*\n\n` +
      'Por favor, digite o código de 6 dígitos aqui para autenticar:'
    );
  }

  private async handleAwaitingOtp(session: UserSession, otpText: string): Promise<string> {
    const code = otpText.replace(/\D/g, '').trim();

    if (code.length !== 6) {
      return '⚠️ Código inválido. Por favor, digite os 6 dígitos numéricos enviados ao seu e-mail (ex: 123456):';
    }

    const verifyResponse = await this.connector.verifyOtp(session.phone, code);

    if (!verifyResponse.success || !verifyResponse.user) {
      return (
        `❌ ${verifyResponse.message || 'Código incorreto ou expirado.'}\n\n` +
        'Tente digitar o código novamente ou digite "sair" para reiniciar.'
      );
    }

    this.sessionManager.updateSession(session.phone, {
      state: 'AUTHENTICATED',
      user: verifyResponse.user,
      pendingEmail: undefined,
    });

    const firstName = verifyResponse.user.fullName.split(' ')[0] || 'Usuário';
    return (
      `✅ Autenticado com sucesso! Olá, *${firstName}*.\n\n` +
      this.renderMenuOptions()
    );
  }

  private async handleAuthenticated(session: UserSession, optionText: string): Promise<string> {
    const option = optionText.trim().toLowerCase();

    if (option === '1' || option.includes('consultar') || option.includes('hoje')) {
      const today = this.getTodayIso();
      const spaces = await this.connector.getAvailableSpaces(today);

      if (spaces.length === 0) {
        return (
          `ℹ️ Não encontramos salas disponíveis para hoje (${this.formatBrDate(today)}).\n\n` +
          'Digite *2* para buscar outra data ou *menu* para voltar.'
        );
      }

      let response = `🏢 *Salas disponíveis hoje (${this.formatBrDate(today)}):*\n\n`;
      spaces.slice(0, 10).forEach((space, index) => {
        response += `*${index + 1}.* ${space.name}\n   Capacidade: ${space.capacity} | Tipo: ${space.type}\n`;
      });

      if (spaces.length > 10) {
        response += `\n_...e mais ${spaces.length - 10} espaços disponíveis._\n`;
      }

      response += '\nDigite *2* para fazer uma reserva ou *menu* para o menu principal.';
      return response;
    }

    if (option === '2' || option.includes('reserva') || option.includes('reservar')) {
      this.sessionManager.updateSession(session.phone, { state: 'SELECTING_DATE' });
      return (
        '📅 *Para qual data deseja fazer a reserva?*\n\n' +
        'Digite:\n' +
        '• *hoje*\n' +
        '• *amanhã*\n' +
        '• ou a data no formato *AAAA-MM-DD* (ex: 2026-11-05)\n\n' +
        '(Digite *menu* para cancelar)'
      );
    }

    if (option === '3' || option.includes('agendamento')) {
      return (
        '📋 *Meus Agendamentos*\n\n' +
        'Você pode gerenciar e visualizar todos os seus agendamentos diretamente pelo portal oficial do Nassau Espaços:\n' +
        '🔗 http://localhost:8085/schedules\n\n' +
        'Digite *menu* para voltar ao menu principal.'
      );
    }

    if (option === '4' || option === 'sair') {
      this.sessionManager.resetSession(session.phone);
      return '👋 Você foi desconectado com segurança. Até a próxima!';
    }

    return (
      '❓ Opção não reconhecida.\n\n' +
      this.renderMenuOptions()
    );
  }

  private async handleSelectingDate(session: UserSession, dateInput: string): Promise<string> {
    const parsedDate = this.parseDateInput(dateInput);

    if (!parsedDate) {
      return (
        '⚠️ Data inválida. Por favor, digite:\n' +
        '• *hoje*\n' +
        '• *amanhã*\n' +
        '• ou a data no formato *AAAA-MM-DD* (ex: 2026-11-05):'
      );
    }

    const spaces = await this.connector.getAvailableSpaces(parsedDate);

    if (spaces.length === 0) {
      return (
        `ℹ️ Nenhum espaço disponível encontrado para a data *${this.formatBrDate(parsedDate)}*.\n\n` +
        'Por favor, informe outra data ou digite *menu* para voltar ao início.'
      );
    }

    this.sessionManager.updateSession(session.phone, {
      state: 'SELECTING_SPACE',
      selectedDate: parsedDate,
      availableSpaces: spaces,
    });

    let message = `📍 *Espaços disponíveis em ${this.formatBrDate(parsedDate)}:*\n\n`;
    spaces.slice(0, 15).forEach((space, index) => {
      message += `*${index + 1}* - ${space.name} (Capacidade: ${space.capacity}, Tipo: ${space.type})\n`;
    });

    message += '\nDigite o *número* correspondente ao espaço desejado (ou *cancelar*):';
    return message;
  }

  private handleSelectingSpace(session: UserSession, spaceInput: string): string {
    const index = parseInt(spaceInput.trim(), 10) - 1;
    const spaces = session.availableSpaces || [];

    if (isNaN(index) || index < 0 || index >= spaces.length) {
      return (
        `⚠️ Número inválido. Por favor, escolha um número de 1 a ${spaces.length} da lista, ` +
        'ou digite *cancelar* para voltar ao menu:'
      );
    }

    const selectedSpace = spaces[index];

    this.sessionManager.updateSession(session.phone, {
      state: 'CONFIRMING_BOOKING',
      selectedSpace,
    });

    return (
      `🏛 Espaço selecionado: *${selectedSpace.name}*\n` +
      `📅 Data: *${this.formatBrDate(session.selectedDate || '')}*\n\n` +
      'Agora informe o horário e o motivo da reserva no formato:\n' +
      '*HH:MM-HH:MM, Nome do Evento*\n\n' +
      'Exemplo:\n' +
      '*08:00-10:00, Reunião de Colegiado*\n\n' +
      '(Ou digite *cancelar* para voltar)'
    );
  }

  private async handleConfirmingBooking(
    session: UserSession,
    detailsInput: string
  ): Promise<string> {
    const parts = detailsInput.split(',');
    if (parts.length < 2) {
      return (
        '⚠️ Formato incorreto. Por favor, envie no formato:\n' +
        '*HH:MM-HH:MM, Nome do Evento*\n\n' +
        'Exemplo: *14:00-16:00, Defesa de TCC*'
      );
    }

    const hoursPart = parts[0].trim();
    const eventName = parts.slice(1).join(',').trim();

    const hoursMatch = hoursPart.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!hoursMatch || !eventName) {
      return (
        '⚠️ Horário ou nome do evento inválido.\n' +
        'Use o formato: *HH:MM-HH:MM, Nome do Evento*\n' +
        'Exemplo: *08:00-10:00, Aula de Algoritmos*'
      );
    }

    const startHour = hoursMatch[1];
    const endHour = hoursMatch[2];
    const space = session.selectedSpace!;
    const date = session.selectedDate!;

    const result = await this.connector.createQuickBooking(
      session.phone,
      space.id,
      eventName,
      date,
      startHour,
      endHour
    );

    if (!result.success) {
      return (
        `❌ *Falha no agendamento:* ${result.message}\n\n` +
        'Tente outro horário ou envie *menu* para reiniciar o processo.'
      );
    }

    // Retorna a sessão para o estado AUTHENTICATED
    this.sessionManager.updateSession(session.phone, {
      state: 'AUTHENTICATED',
      selectedDate: undefined,
      selectedSpace: undefined,
      availableSpaces: undefined,
    });

    return (
      '🎉 *Reserva confirmada com sucesso!*\n\n' +
      `📌 *Código:* ${result.bookingId || 'CONFIRMADO'}\n` +
      `🏛 *Espaço:* ${space.name}\n` +
      `📅 *Data:* ${this.formatBrDate(date)}\n` +
      `⏰ *Horário:* ${startHour} às ${endHour}\n` +
      `📝 *Evento:* ${eventName}\n\n` +
      'Como posso ajudar agora?\n' +
      this.renderMenuOptions()
    );
  }

  private renderMainMenu(fullName?: string): string {
    const name = fullName ? fullName.split(' ')[0] : 'Usuário';
    return `Olá, *${name}*! Como posso te ajudar?\n\n` + this.renderMenuOptions();
  }

  private renderMenuOptions(): string {
    return (
      '1 - Consultar salas livres hoje\n' +
      '2 - Fazer reserva rápida\n' +
      '3 - Meus agendamentos\n' +
      '4 - Sair'
    );
  }

  private getTodayIso(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateInput(input: string): string | null {
    const text = input.trim().toLowerCase();
    const now = new Date();

    if (text === 'hoje' || text === 'today') {
      return this.getTodayIso();
    }

    if (text === 'amanha' || text === 'amanhã' || text === 'tomorrow') {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const year = tomorrow.getFullYear();
      const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const day = String(tomorrow.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Formato YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }

    // Formato DD/MM/YYYY
    const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) {
      return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
    }

    return null;
  }

  private formatBrDate(isoDate: string): string {
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoDate;
  }
}
