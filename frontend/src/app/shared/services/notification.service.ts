import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AppNotification {
  _id: string;
  userId: string;
  type: 'profile_update' | 'resume_upload' | 'github_update' | 'low_score' | 'career_update' | 'system';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface NotificationResponse {
  notifications: AppNotification[];
  unreadCount: number;
  total?: number;
  page?: number;
  totalPages?: number;
}

export interface NotificationQuery {
  page?: number;
  limit?: number;
  search?: string;
  from?: string;
  to?: string;
  userId?: string;
  organizationId?: string;
  teamId?: string;
  role?: string;
  type?: string;
  unread?: boolean;
  includeAllOrgs?: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly baseUrl = 'http://localhost:5000/api/notifications';

  constructor(private readonly http: HttpClient) {}

  getNotifications(query: NotificationQuery = {}): Observable<NotificationResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params.set(key, String(value));
    });
    const suffix = params.toString();
    const endpoint = suffix ? `${this.baseUrl}?${suffix}` : this.baseUrl;
    return this.http.get<NotificationResponse>(endpoint);
  }

  markAsRead(notificationId: string, params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {}): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/${notificationId}/read`, params);
  }

  markAllAsRead(): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/read-all`, {});
  }

  deleteNotification(notificationId: string, params: Pick<NotificationQuery, 'organizationId' | 'teamId'> = {}): Observable<{ message: string }> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (!value) return;
      query.set(key, String(value));
    });
    const suffix = query.toString();
    const endpoint = suffix ? `${this.baseUrl}/${notificationId}?${suffix}` : `${this.baseUrl}/${notificationId}`;
    return this.http.delete<{ message: string }>(endpoint);
  }

  createStream(token: string): EventSource {
    const encodedToken = encodeURIComponent(token);
    return new EventSource(`${this.baseUrl}/stream?token=${encodedToken}`);
  }
}
