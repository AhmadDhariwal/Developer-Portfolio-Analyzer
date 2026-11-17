import { AppNotification } from '../../shared/services/notification.service';
// Shared pure formatting; neither parent nor children own additional requests or streams.
// Quick-filter state is supplied by the orchestration parent.

export class NotificationPresentation {
  typeFilter = '';
  unreadOnly = false;
  formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    return date.toLocaleString();
  }

  getNotificationTone(notification: AppNotification): string {
    switch (notification.type) {
      case 'low_score':
        return 'warning';
      case 'resume_upload':
        return 'success';
      case 'github_update':
        return 'info';
      case 'career_update':
        return 'purple';
      case 'profile_update':
        return 'neutral';
      default:
        return 'system';
    }
  }

  getNotificationIcon(notification: AppNotification): string {
    switch (notification.type) {
      case 'profile_update':
        return 'user';
      case 'resume_upload':
        return 'file';
      case 'github_update':
        return 'github';
      case 'low_score':
        return 'alert';
      case 'career_update':
        return 'spark';
      default:
        return 'bell';
    }
  }

  getNotificationTypeLabel(notification: AppNotification): string {
    return notification.type.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  getRelativeTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  isQuickFilterActive(category: string): boolean {
    if (category === 'all') return !this.typeFilter && !this.unreadOnly;
    if (category === 'unread') return this.unreadOnly;
    return this.typeFilter === category && !this.unreadOnly;
  }
}
