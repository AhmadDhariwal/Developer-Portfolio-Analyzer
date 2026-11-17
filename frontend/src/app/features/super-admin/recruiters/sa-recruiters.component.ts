import { Component, OnInit, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SuperAdminService } from '../shared/super-admin.service';
import { SaPagerComponent } from '../shared/components/sa-pager/sa-pager.component';
import { SaUserFormModalComponent } from '../shared/components/sa-user-form-modal/sa-user-form-modal.component';

@Component({
  selector: 'app-sa-recruiters',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SaPagerComponent, SaUserFormModalComponent],
  templateUrl: './sa-recruiters.component.html',
  styleUrls: ['./sa-recruiters.component.scss']
})
export class SaRecruitersComponent implements OnInit {
  recruiters: any[] = [];
  total = 0; page = 1; totalPages = 1;
  loading = false;
  search = '';
  organizationId = '';
  active = '';
  teamId = '';
  joinedFrom = '';
  joinedTo = '';
  sort = 'createdAt';
  sortOrder = 'desc';
  organizations: any[] = [];
  readonly pageSize = 30;
  topPerformers: any[] = [];
  teams: any[] = [];
  analyticsPanelOpen = false;
  analyticsData: any = null;
  analyticsLoading = false;
  analyticsError = '';
  selectedRecruiter: any = null;
  selectedTeamId = '';

  formOpen = false;
  formMode: 'create' | 'edit' = 'create';
  formBusy = false;
  formError = '';
  selected: any = null;

  constructor(
    private readonly sa: SuperAdminService,
    private readonly cdr: ChangeDetectorRef,
  private readonly destroyRef: DestroyRef
  ) {}
  ngOnInit(): void {
    this.loadOrgs();
    this.load();
    this.loadTeams();
  }

  load(page = 1): void {
    this.loading = true; this.page = page;
    const params: Record<string, string> = { page: String(page), limit: String(this.pageSize) };
    if (this.search) params['search'] = this.search;
    if (this.organizationId) params['organizationId'] = this.organizationId;
    if (this.active) params['active'] = this.active;
    if (this.teamId) params['teamId'] = this.teamId;
    if (this.joinedFrom) params['joinedFrom'] = this.joinedFrom;
    if (this.joinedTo) params['joinedTo'] = this.joinedTo;
    if (this.sort) params['sort'] = this.sort;
    if (this.sortOrder) params['sortOrder'] = this.sortOrder;
    this.sa.getRecruiters(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.recruiters = res.recruiters || [];
        this.total = res.total || 0;
        this.totalPages = res.totalPages || 1;
        this.loading = false;
        // compute top performers for analytics card (simple heuristic)
        this.topPerformers = [...this.recruiters].sort((a,b) => (b.activityScore||0) - (a.activityScore||0)).slice(0,3);
        try { this.cdr.detectChanges(); } catch {}
      },
      error: () => {
        this.loading = false;
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  loadOrgs(): void {
    this.sa.getOrganizations({ page: '1', limit: '100' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.organizations = res?.organizations || [];
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  loadTeams(): void {
    this.sa.getTeams({ page: '1', limit: '100' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.teams = res?.teams || [];
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  openCreate(): void {
    this.selected = null;
    this.formMode = 'create';
    this.formError = '';
    this.formOpen = true;
  }

  openEdit(user: any): void {
    this.selected = user;
    this.formMode = 'edit';
    this.formError = '';
    this.formOpen = true;
  }

  save(payload: Record<string, any>): void {
    this.formBusy = true;
    this.formError = '';

    const req$ = this.formMode === 'create'
      ? this.sa.createUser(payload)
      : this.sa.updateUser(this.selected?._id, payload);

    req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.formBusy = false;
        this.formOpen = false;
        this.load(this.page);
        try { this.cdr.detectChanges(); } catch {}
      },
      error: (err) => {
        this.formBusy = false;
        this.formError = err?.error?.message || 'Failed to save.';
        try { this.cdr.detectChanges(); } catch {}
      }
    });
  }

  toggle(user: any): void {
    this.sa.toggleUserActive(user._id).subscribe({ next: () => this.load(this.page) });
  }

  viewAnalytics(user: any): void {
    this.selectedRecruiter = user;
    this.analyticsLoading = true;
    this.analyticsError = '';
    this.sa.getRecruiterAnalytics(user._id).subscribe({
      next: (res: any) => {
        this.analyticsData = res?.analytics ?? res?.data ?? res;
        this.analyticsPanelOpen = true;
        this.analyticsLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.analyticsLoading = false;
        this.analyticsError = err?.error?.message || 'Unable to load recruiter analytics.';
        this.analyticsPanelOpen = true;
        this.cdr.detectChanges();
      }
    });
  }

  closeAnalytics(): void {
    this.analyticsPanelOpen = false;
    this.analyticsError = '';
    this.selectedRecruiter = null;
    this.selectedTeamId = '';
  }

  assignSelectedTeam(): void {
    if (!this.selectedRecruiter?._id || !this.selectedTeamId) {
      return;
    }

    const team = this.teams.find((entry) => String(entry._id) === String(this.selectedTeamId));
    this.sa.assignTeamToRecruiter(this.selectedRecruiter._id, this.selectedTeamId).subscribe({
      next: () => {
        if (team) {
          this.selectedRecruiter.assignedTeams = [
            ...(this.selectedRecruiter.assignedTeams || []).filter((entry: any) => String(entry._id) !== String(team._id)),
            { _id: team._id, name: team.name }
          ];
        }
        this.load(this.page);
        this.selectedTeamId = '';
      }
    });
  }

  removeSelectedTeam(teamId: string): void {
    if (!this.selectedRecruiter?._id || !teamId) {
      return;
    }

    this.sa.removeRecruiterTeam(this.selectedRecruiter._id, teamId).subscribe({
      next: () => {
        this.selectedRecruiter.assignedTeams = (this.selectedRecruiter.assignedTeams || [])
          .filter((entry: any) => String(entry._id) !== String(teamId));
        this.load(this.page);
      }
    });
  }

  removeRecruiter(user: any): void {
    if (!user?._id) {
      return;
    }

    const confirmed = window.confirm(`Remove ${user.name || 'this recruiter'} from the platform?`);
    if (!confirmed) {
      return;
    }

    this.sa.deleteUser(user._id).subscribe({
      next: () => this.load(this.page)
    });
  }

  analyticsBarWidth(value: number, multiplier = 1): number {
    return Math.max(6, Math.min(100, Number(value || 0) * multiplier));
  }

  teamNames(teams: Array<{ name?: string }> = []): string {
    return teams.map((team) => team?.name).filter(Boolean).join(', ');
  }
}
