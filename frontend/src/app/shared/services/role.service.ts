import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type TargetRole = 
  | 'Frontend Developer' 
  | 'Backend Developer' 
  | 'Full Stack Developer' 
  | 'AI / ML Engineer' 
  | 'DevOps Engineer' 
  | 'Mobile Developer';

@Injectable({
  providedIn: 'root'
})
export class RoleService {
  private roles: TargetRole[] = [
    'Frontend Developer',
    'Backend Developer',
    'Full Stack Developer',
    'AI / ML Engineer',
    'DevOps Engineer',
    'Mobile Developer'
  ];

  private targetRoleSubject = new BehaviorSubject<TargetRole>('Full Stack Developer');
  targetRole$ = this.targetRoleSubject.asObservable();

  constructor() {
    const savedRole = localStorage.getItem('devinsight_target_role');
    if (savedRole && this.roles.includes(savedRole as TargetRole)) {
      this.targetRoleSubject.next(savedRole as TargetRole);
    }
  }

  getRoles(): TargetRole[] {
    return this.roles;
  }

  setRole(role: TargetRole): void {
    this.targetRoleSubject.next(role);
    localStorage.setItem('devinsight_target_role', role);
  }

  getCurrentRole(): TargetRole {
    return this.targetRoleSubject.value;
  }
}
