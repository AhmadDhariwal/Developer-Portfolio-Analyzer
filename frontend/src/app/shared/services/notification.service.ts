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
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly baseUrl = 'http://localhost:5000/api/notifications';

  constructor(private readonly http: HttpClient) {}

  getNotifications(limit = 20): Observable<NotificationResponse> {
    return this.http.get<NotificationResponse>(`${this.baseUrl}?limit=${limit}`);
  }

  markAsRead(notificationId: string): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/${notificationId}/read`, {});
  }

  markAllAsRead(): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.baseUrl}/read-all`, {});
  }

  createStream(token: string): EventSource {
    const encodedToken = encodeURIComponent(token);
    return new EventSource(`${this.baseUrl}/stream?token=${encodedToken}`);
  }
}
