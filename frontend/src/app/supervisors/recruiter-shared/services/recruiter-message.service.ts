import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type RecruiterMessageType = 'success' | 'error' | 'warning';

export interface RecruiterMessageState {
  visible: boolean;
  type: RecruiterMessageType;
  text: string;
}

const EMPTY_MESSAGE: RecruiterMessageState = {
  visible: false,
  type: 'success',
  text: ''
};

@Injectable({
  providedIn: 'root'
})
export class RecruiterMessageService {
  private readonly messageSubject = new BehaviorSubject<RecruiterMessageState>(EMPTY_MESSAGE);
  readonly message$ = this.messageSubject.asObservable();

  show(type: RecruiterMessageType, text: string): void {
    this.messageSubject.next({ visible: true, type, text });
  }

  success(text: string): void {
    this.show('success', text);
  }

  error(text: string): void {
    this.show('error', text);
  }

  warning(text: string): void {
    this.show('warning', text);
  }

  clear(): void {
    this.messageSubject.next(EMPTY_MESSAGE);
  }
}
