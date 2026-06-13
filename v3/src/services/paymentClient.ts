/**
 * Payment API Client
 * Marblo 결제 시스템과 연동하기 위한 클라이언트 라이브러리
 */

import {
  PaymentRequestData,
  PaymentResponse,
  PaymentConfirmData,
  PaymentCancelData,
  BillingKeyRequest,
  BillingKeyResponse,
  SubscriptionCreateData,
  SubscriptionResponse,
  SubscriptionUpdateData,
  SubscriptionCancelData,
  BillingHistoryResponse,
  PaymentStatistics,
  SubscriptionStatistics,
  ErrorResponse,
  PaymentListParams,
  PaymentStatus,
} from "../types/payment";

interface PaymentClientConfig {
  apiBaseUrl: string;
  apiKey?: string;
  timeout?: number;
}

class PaymentClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: PaymentClientConfig) {
    this.baseUrl = config.apiBaseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000; // 30 seconds default
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;

    // Record<string,string> (not HeadersInit) so we can do indexed
    // writes (Authorization). HeadersInit is a union of Headers | string[][]
    // | Record<string,string> and TS rejects indexing on the union form.
    // The Record gets implicitly widened back to HeadersInit when spread
    // into RequestInit below.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> | undefined),
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const config: RequestInit = {
      ...options,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        let errorData: ErrorResponse;
        try {
          errorData = await response.json();
        } catch {
          errorData = {
            detail: `HTTP ${response.status}: ${response.statusText}`,
            type: "HTTPError",
            code: `HTTP_${response.status}`,
          };
        }
        throw new PaymentError(errorData, response.status);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }

      throw new PaymentError({
        detail:
          error instanceof Error ? error.message : "Unknown error occurred",
        type: "NetworkError",
        code: "NETWORK_ERROR",
      });
    }
  }

  // Payment Operations
  async requestPayment(data: PaymentRequestData): Promise<PaymentResponse> {
    return this.request<PaymentResponse>("/payments/request", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async confirmPayment(data: PaymentConfirmData): Promise<PaymentResponse> {
    return this.request<PaymentResponse>("/payments/confirm", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async cancelPayment(data: PaymentCancelData): Promise<PaymentResponse> {
    return this.request<PaymentResponse>("/payments/cancel", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getPaymentStatus(paymentKey: string): Promise<any> {
    return this.request(`/payments/status/${paymentKey}`);
  }

  async getPaymentHistory(
    params: PaymentListParams = {}
  ): Promise<PaymentResponse[]> {
    const searchParams = new URLSearchParams();

    if (params.skip !== undefined)
      searchParams.set("skip", params.skip.toString());
    if (params.limit !== undefined)
      searchParams.set("limit", params.limit.toString());
    if (params.status) searchParams.set("status", params.status);
    if (params.start_date) searchParams.set("start_date", params.start_date);
    if (params.end_date) searchParams.set("end_date", params.end_date);

    const query = searchParams.toString();
    const endpoint = `/payments/history${query ? `?${query}` : ""}`;

    return this.request<PaymentResponse[]>(endpoint);
  }

  async getPaymentDetail(paymentId: number): Promise<PaymentResponse> {
    return this.request<PaymentResponse>(`/payments/${paymentId}`);
  }

  // Billing Key Management
  async registerBillingKey(
    data: BillingKeyRequest
  ): Promise<BillingKeyResponse> {
    return this.request<BillingKeyResponse>("/payments/billing/register", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Subscription Management
  async createSubscription(
    data: SubscriptionCreateData
  ): Promise<SubscriptionResponse> {
    return this.request<SubscriptionResponse>("/payments/subscriptions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getCurrentSubscription(): Promise<SubscriptionResponse> {
    return this.request<SubscriptionResponse>(
      "/payments/subscriptions/current"
    );
  }

  async updateSubscription(
    subscriptionId: number,
    data: SubscriptionUpdateData
  ): Promise<SubscriptionResponse> {
    return this.request<SubscriptionResponse>(
      `/payments/subscriptions/${subscriptionId}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
  }

  async cancelSubscription(
    subscriptionId: number,
    data: SubscriptionCancelData
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/payments/subscriptions/${subscriptionId}/cancel`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
  }

  async getBillingHistory(
    subscriptionId: number
  ): Promise<BillingHistoryResponse[]> {
    return this.request<BillingHistoryResponse[]>(
      `/payments/subscriptions/${subscriptionId}/billing-history`
    );
  }

  // Statistics
  async getPaymentStatistics(
    startDate: string,
    endDate: string,
    userId?: number
  ): Promise<PaymentStatistics> {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

    if (userId) {
      params.set("user_id", userId.toString());
    }

    return this.request<PaymentStatistics>(
      `/payments/statistics/payments?${params.toString()}`
    );
  }

  async getSubscriptionStatistics(): Promise<SubscriptionStatistics> {
    return this.request<SubscriptionStatistics>(
      "/payments/statistics/subscriptions"
    );
  }
}

// Custom Error Class
class PaymentError extends Error {
  public readonly errorData: ErrorResponse;
  public readonly statusCode?: number;

  constructor(errorData: ErrorResponse, statusCode?: number) {
    super(errorData.detail);
    this.name = "PaymentError";
    this.errorData = errorData;
    this.statusCode = statusCode;
  }
}

// Client Factory
export function createPaymentClient(
  config: PaymentClientConfig
): PaymentClient {
  return new PaymentClient(config);
}

// React Hook for Payment Client
import { useMemo } from "react";

interface UsePaymentClientConfig extends PaymentClientConfig {}

export function usePaymentClient(config: UsePaymentClientConfig) {
  return useMemo(
    () => createPaymentClient(config),
    [config.apiBaseUrl, config.apiKey, config.timeout]
  );
}

// Utility Functions
export class PaymentUtils {
  /**
   * Format Korean Won amount with comma separators
   */
  static formatKRW(amount: number): string {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: "KRW",
    }).format(amount);
  }

  /**
   * Get payment status display text in Korean
   */
  static getPaymentStatusText(status: PaymentStatus): string {
    const statusMap: Record<PaymentStatus, string> = {
      [PaymentStatus.PENDING]: "결제 대기",
      [PaymentStatus.READY]: "결제 준비",
      [PaymentStatus.IN_PROGRESS]: "결제 진행중",
      [PaymentStatus.DONE]: "결제 완료",
      [PaymentStatus.CANCELED]: "결제 취소",
      [PaymentStatus.PARTIAL_CANCELED]: "부분 취소",
      [PaymentStatus.ABORTED]: "결제 중단",
      [PaymentStatus.EXPIRED]: "결제 만료",
    };
    return statusMap[status] || "알 수 없음";
  }

  /**
   * Get payment status color class for UI
   */
  static getPaymentStatusColor(status: PaymentStatus): string {
    const colorMap: Record<PaymentStatus, string> = {
      [PaymentStatus.PENDING]: "text-yellow-600",
      [PaymentStatus.READY]: "text-blue-600",
      [PaymentStatus.IN_PROGRESS]: "text-blue-600",
      [PaymentStatus.DONE]: "text-green-600",
      [PaymentStatus.CANCELED]: "text-red-600",
      [PaymentStatus.PARTIAL_CANCELED]: "text-orange-600",
      [PaymentStatus.ABORTED]: "text-red-600",
      [PaymentStatus.EXPIRED]: "text-gray-600",
    };
    return colorMap[status] || "text-gray-600";
  }

  /**
   * Calculate yearly price (2 months free — annual = monthly × 10)
   */
  static calculateYearlyDiscount(monthlyPrice: number): number {
    return monthlyPrice * 10;
  }

  /**
   * Validate card number using Luhn algorithm
   */
  static validateCardNumber(cardNumber: string): boolean {
    const cleanNumber = cardNumber.replace(/\D/g, "");
    if (cleanNumber.length < 13 || cleanNumber.length > 19) return false;

    let sum = 0;
    let isEven = false;

    for (let i = cleanNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cleanNumber[i]);

      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }

  /**
   * Format card number with spaces
   */
  static formatCardNumber(cardNumber: string): string {
    const cleanNumber = cardNumber.replace(/\D/g, "");
    const groups = cleanNumber.match(/(\d{1,4})/g) || [];
    return groups.join(" ").substr(0, 19);
  }

  /**
   * Mask card number for display
   */
  static maskCardNumber(cardNumber: string): string {
    const cleanNumber = cardNumber.replace(/\D/g, "");
    if (cleanNumber.length < 4) return cardNumber;

    const lastFour = cleanNumber.slice(-4);
    const masked = "*".repeat(cleanNumber.length - 4);
    return `${masked}${lastFour}`;
  }
}

// PaymentClient / PaymentError / PaymentUtils are already exported via
// their `export class` declarations. Re-listing them here would trigger
// TS2323 (Cannot redeclare) / TS2484 (export conflict).
export default PaymentClient;
