import { ExternalSystemConnector, AuthenticatedUser, SpaceItem } from './connector.interface.js';

export interface PrimaryPointConnectorConfig {
  baseUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
}

export class PrimaryPointConnector implements ExternalSystemConnector {
  public readonly systemName = 'Nassau Espaços (Primary Point)';
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly timeoutMs: number;

  constructor(config?: PrimaryPointConnectorConfig) {
    this.baseUrl = (
      config?.baseUrl ||
      process.env.PRIMARY_POINT_API_URL ||
      'http://agendador-dev-api-1:3000/api/v1/integrations/whatsapp'
    ).replace(/\/$/, '');

    this.serviceToken =
      config?.serviceToken ||
      process.env.PRIMARY_POINT_SERVICE_TOKEN ||
      'local-dev-bot-token-2026';

    this.timeoutMs = config?.timeoutMs || 8000;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
    } = {}
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-service-token': this.serviceToken,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const responseData = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const errorMsg =
          typeof responseData === 'object' && responseData && 'message' in responseData
            ? String((responseData as { message: unknown }).message)
            : `HTTP error ${response.status}: ${response.statusText}`;
        return { ok: false, status: response.status, error: errorMsg };
      }

      return { ok: true, status: response.status, data: responseData as T };
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        error: isAbort
          ? `Tempo limite excedido (${this.timeoutMs}ms) ao conectar com Nassau Espaços.`
          : err instanceof Error
            ? err.message
            : 'Erro de conexão com o sistema Nassau Espaços.',
      };
    }
  }

  async requestOtp(phone: string, email: string): Promise<{ success: boolean; message: string }> {
    const res = await this.makeRequest<{ success?: boolean; message?: string }>(
      '/otp/request',
      {
        method: 'POST',
        body: { phone, email },
      }
    );

    if (!res.ok) {
      return {
        success: false,
        message: res.error || 'Falha ao solicitar código de verificação.',
      };
    }

    return {
      success: true,
      message: res.data?.message || 'Código enviado com sucesso para o seu e-mail institucional.',
    };
  }

  async verifyOtp(
    phone: string,
    code: string
  ): Promise<{ success: boolean; user?: AuthenticatedUser; message: string }> {
    const res = await this.makeRequest<{
      success?: boolean;
      user?: AuthenticatedUser;
      message?: string;
    }>('/otp/verify', {
      method: 'POST',
      body: { phone, code },
    });

    if (!res.ok || !res.data) {
      return {
        success: false,
        message: res.error || 'Código de verificação incorreto ou expirado.',
      };
    }

    return {
      success: true,
      user: res.data.user,
      message: res.data.message || 'Autenticação realizada com sucesso!',
    };
  }

  async getAvailableSpaces(date?: string): Promise<SpaceItem[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await this.makeRequest<SpaceItem[] | { spaces: SpaceItem[] }>(`/spaces${query}`);

    if (!res.ok || !res.data) {
      return [];
    }

    if (Array.isArray(res.data)) {
      return res.data;
    }

    if ('spaces' in res.data && Array.isArray(res.data.spaces)) {
      return res.data.spaces;
    }

    return [];
  }

  async createQuickBooking(
    phone: string,
    spaceId: string,
    eventName: string,
    date: string,
    startHour: string,
    endHour: string
  ): Promise<{ success: boolean; bookingId?: string; message: string }> {
    const res = await this.makeRequest<{
      success?: boolean;
      bookingId?: string;
      message?: string;
    }>('/bookings/quick', {
      method: 'POST',
      body: {
        phone,
        spaceId,
        eventName,
        date,
        startHour,
        endHour,
      },
    });

    if (!res.ok || !res.data) {
      return {
        success: false,
        message: res.error || 'Não foi possível confirmar o agendamento.',
      };
    }

    return {
      success: true,
      bookingId: res.data.bookingId,
      message: res.data.message || 'Agendamento confirmado com sucesso!',
    };
  }
}
