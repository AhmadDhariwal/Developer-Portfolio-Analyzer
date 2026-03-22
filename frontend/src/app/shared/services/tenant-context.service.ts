import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface TenantContextState {
  organizationId: string;
  organizationName: string;
  myRole: 'admin' | 'manager' | 'member' | '';
  teamId: string;
  teamName: string;
}

const STORAGE_KEY = 'devinsight_tenant_context';

const EMPTY_STATE: TenantContextState = {
  organizationId: '',
  organizationName: '',
  myRole: '',
  teamId: '',
  teamName: ''
};

@Injectable({
  providedIn: 'root'
})
export class TenantContextService {
  private readonly stateSubject = new BehaviorSubject<TenantContextState>(this.loadState());
  readonly state$ = this.stateSubject.asObservable();

  get snapshot(): TenantContextState {
    return this.stateSubject.value;
  }

  setOrganization(org: { id: string; name: string; myRole?: 'admin' | 'manager' | 'member' | '' }): void {
    const next: TenantContextState = {
      organizationId: org.id,
      organizationName: org.name,
      myRole: org.myRole || '',
      teamId: '',
      teamName: ''
    };
    this.persist(next);
  }

  setTeam(team: { id: string; name: string }): void {
    const current = this.snapshot;
    const next: TenantContextState = {
      ...current,
      teamId: team.id,
      teamName: team.name
    };
    this.persist(next);
  }

  clearTeam(): void {
    const current = this.snapshot;
    const next: TenantContextState = {
      ...current,
      teamId: '',
      teamName: ''
    };
    this.persist(next);
  }

  clearAll(): void {
    this.persist(EMPTY_STATE);
  }

  private loadState(): TenantContextState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return EMPTY_STATE;
      const parsed = JSON.parse(raw);
      return {
        organizationId: String(parsed.organizationId || ''),
        organizationName: String(parsed.organizationName || ''),
        myRole: (parsed.myRole || '') as TenantContextState['myRole'],
        teamId: String(parsed.teamId || ''),
        teamName: String(parsed.teamName || '')
      };
    } catch {
      return EMPTY_STATE;
    }
  }

  private persist(next: TenantContextState): void {
    this.stateSubject.next(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
}
