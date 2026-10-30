export interface EvolutionProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  instanceName?: string;
  timeoutMs?: number;
}

export class EvolutionProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;
  private readonly timeoutMs: number;

  constructor(config?: EvolutionProviderConfig) {
    this.baseUrl = (
      config?.baseUrl ||
      process.env.EVOLUTION_API_URL ||
      'http://evolution-api:8086'
    ).replace(/\/$/, '');

    this.apiKey =
      config?.apiKey ||
      process.env.EVOLUTION_API_KEY ||
      'evolution-local-secret-2026';

    this.instanceName =
      config?.instanceName ||
      process.env.EVOLUTION_INSTANCE_NAME ||
      'nassauBot';

    this.timeoutMs = config?.timeoutMs || 10000;
  }

  public normalizePhoneNumber(phone: string): string {
    let clean = phone.replace(/\D/g, '');
    // Se não tiver código de país (Brasil = 55) e tiver 10 ou 11 dígitos, adiciona 55
    if (clean.length === 10 || clean.length === 11) {
      clean = `55${clean}`;
    }
    return clean;
  }

  public async sendTextMessage(
    recipientPhone: string,
    text: string
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const number = this.normalizePhoneNumber(recipientPhone);
    const url = `${this.baseUrl}/message/sendText/${this.instanceName}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
        body: JSON.stringify({
          number,
          text,
          delay: 1000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        return {
          success: false,
          error: `Evolution API HTTP ${response.status}: ${JSON.stringify(data)}`,
        };
      }

      return { success: true, data };
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        success: false,
        error: isAbort
          ? `Timeout (${this.timeoutMs}ms) ao enviar mensagem via Evolution API.`
          : err instanceof Error
            ? err.message
            : 'Erro desconhecido ao comunicar com Evolution API.',
      };
    }
  }

  public async checkInstanceStatus(): Promise<{
    success: boolean;
    state?: string;
    error?: string;
  }> {
    const url = `${this.baseUrl}/instance/connectionState/${this.instanceName}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          apikey: this.apiKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as { instance?: { state?: string } };
      return {
        success: true,
        state: data.instance?.state || 'unknown',
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Falha ao consultar instância',
      };
    }
  }
}
