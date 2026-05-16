import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MaintenanceModeService {
  private readonly stateSubject = new BehaviorSubject<{ open: boolean; message: string }>({
    open: false,
    message: ''
  });

  readonly state$ = this.stateSubject.asObservable();

  open(message = 'Application is under maintenance. Please go back to sign in and try again later.'): void {
    this.stateSubject.next({ open: true, message });
  }

  close(): void {
    this.stateSubject.next({ open: false, message: '' });
  }
}
