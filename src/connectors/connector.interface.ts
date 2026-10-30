export interface AuthenticatedUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  campusId?: string;
}

export interface SpaceItem {
  id: string;
  name: string;
  capacity: number;
  type: string;
}

export interface ExternalSystemConnector {
  readonly systemName: string;
  requestOtp(phone: string, email: string): Promise<{ success: boolean; message: string }>;
  verifyOtp(phone: string, code: string): Promise<{ success: boolean; user?: AuthenticatedUser; message: string }>;
  getAvailableSpaces(date?: string): Promise<SpaceItem[]>;
  createQuickBooking(
    phone: string,
    spaceId: string,
    eventName: string,
    date: string,
    startHour: string,
    endHour: string
  ): Promise<{ success: boolean; bookingId?: string; message: string }>;
}
