export interface SupportTicketDraft {
  category: string;
  priority: string;
  subject: string;
  message: string;
  replyToEmail: string;
}

export interface SupportCategoryCard {
  value: string;
  title: string;
  description: string;
  icon: string;
  iconClass: string;
}

export interface SupportFaqItem {
  question: string;
  answer: string;
}
