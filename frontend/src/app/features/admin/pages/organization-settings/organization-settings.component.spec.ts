import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { OrganizationSettingsComponent } from './organization-settings.component';
import { OrganizationPoliciesComponent } from '../organization-policies/organization-policies.component';
import { AuthService } from '../../../../shared/services/auth.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { OrganizationPolicyState } from '../../../../shared/services/organization-policy-state.service';
import { policyStateFixture } from '../../../../shared/testing/organization-policy-state.fixture';
import { OrganizationConfigurationStore } from '../../services/organization-configuration.store';
import { governanceFixture, preferencesFixture } from './organization-configuration.fixture';

describe('Organization configuration rendered contracts', () => {
  let http: HttpTestingController;
  let user: BehaviorSubject<any>;
  beforeEach(() => {
    user = new BehaviorSubject({ _id: 'admin-a', role: 'admin', organizationId: 'org-a' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentUser$: user } },
        {
          provide: TenantContextService,
          useValue: { state$: new BehaviorSubject({ organizationId: 'org-a' }) },
        },
        { provide: OrganizationPolicyState, useFactory: policyStateFixture },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify({ ignoreCancelled: true }));
  function flush(version = 3) {
    http
      .expectOne((request) => request.url.endsWith('/governance'))
      .flush(governanceFixture(version));
    http
      .expectOne((request) => request.url.endsWith('/preferences'))
      .flush(preferencesFixture(version));
    for (const request of http.match((request) => request.url.endsWith('/teams')))
      request.flush({ teams: [{ _id: 'team-a', name: 'Engineering team' }] });
  }
  async function settings() {
    const fixture = TestBed.createComponent(OrganizationSettingsComponent);
    fixture.detectChanges();
    flush();
    await fixture.whenStable();
    return fixture;
  }
  async function type(
    fixture: ComponentFixture<OrganizationSettingsComponent>,
    selector: string,
    value: string,
  ) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }
  const button = (fixture: ComponentFixture<any>, label: string) =>
    [...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)].find(
      (button) => button.textContent?.trim() === label,
    )!;

  it('renders delayed committed values without another interaction in zoneless mode', async () => {
    const fixture = TestBed.createComponent(OrganizationSettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading organization');
    flush();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#name').value).toBe('Engineering organization');
    expect(fixture.nativeElement.querySelector('[role=status]')).toBeNull();
  });
  it.each([
    ['name', 'x', '2–80'],
    ['website', 'http://example.test', 'HTTPS'],
    ['website', 'https://user:password@example.test', 'credentials'],
    ['website', 'https://example.test?q=a', 'query'],
    ['logoUrl', 'https://example.test/logo#fragment', 'fragments'],
    ['timezone', 'Invalid/Timezone', 'IANA'],
  ])(
    'validates %s against the server contract before a mutation',
    async (field, value, message) => {
      const fixture = await settings();
      await type(fixture, `#${field}`, value);
      button(fixture, 'Save organization').click();
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(message);
      http.expectNone((request) => request.method === 'PATCH');
    },
  );
  it('forwards the loaded version, supports clearing and uses the committed response', async () => {
    const fixture = await settings();
    await type(fixture, '#description', '');
    button(fixture, 'Save organization').click();
    const patch = http.expectOne((request) => request.method === 'PATCH');
    expect(patch.request.body.expectedVersion).toBe(3);
    expect(patch.request.body.general.description).toBe('');
    expect(TestBed.inject(OrganizationConfigurationStore).committed()?.version).toBe(3);
    const saved = governanceFixture(4);
    saved.organization.description = '';
    patch.flush(saved);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Organization settings saved');
    expect(fixture.componentInstance.dirty).toBe(false);
  });
  it('preserves unsaved edits on 409, fetches current values and requires review plus a new Save', async () => {
    const fixture = await settings();
    await type(fixture, '#name', 'My unsaved name');
    button(fixture, 'Save organization').click();
    http
      .expectOne((request) => request.method === 'PATCH')
      .flush({}, { status: 409, statusText: 'Conflict' });
    flush(4);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#name').value).toBe('My unsaved name');
    expect(fixture.nativeElement.textContent).toContain('Current server value');
    expect(button(fixture, 'Save organization').disabled).toBe(true);
    expect(TestBed.inject(OrganizationConfigurationStore).saving()).toBe(false);
    http.expectNone((request) => request.method === 'PATCH');
    button(fixture, 'I reviewed the server changes').click();
    await fixture.whenStable();
    http.expectNone((request) => request.method === 'PATCH');
    button(fixture, 'Save organization').click();
    const retry = http.expectOne((request) => request.method === 'PATCH');
    expect(retry.request.body.expectedVersion).toBe(4);
    expect(retry.request.body.general.name).toBe('My unsaved name');
    retry.flush(governanceFixture(5));
    await fixture.whenStable();
  });
  it('cancels drafts back to committed values and shares the committed version with dashboard saves', async () => {
    const fixture = await settings();
    await type(fixture, '#name', 'Draft name');
    button(fixture, 'Cancel changes').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#name').value).toBe('Engineering organization');
    await type(fixture, '#industry', 'Systems');
    button(fixture, 'Save organization').click();
    http.expectOne((request) => request.method === 'PATCH').flush(governanceFixture(4));
    await fixture.whenStable();
    const checkbox = [
      ...(fixture.nativeElement.querySelectorAll('label') as NodeListOf<HTMLLabelElement>),
    ]
      .find((label) => label.textContent?.includes('Activity feed'))!
      .querySelector('input') as HTMLInputElement;
    checkbox.click();
    await fixture.whenStable();
    button(fixture, 'Save dashboard configuration').click();
    const patch = http.expectOne((request) => request.method === 'PATCH');
    expect(patch.request.body.expectedVersion).toBe(4);
    expect(patch.request.body.dashboardConfig.showActivityFeed).toBe(false);
    const saved = preferencesFixture(5);
    saved.organization.dashboardConfig!.showActivityFeed = false;
    patch.flush(saved);
    await fixture.whenStable();
    expect(TestBed.inject(OrganizationConfigurationStore).committed()?.version).toBe(5);
  });
  it('does not expose protected settings when legacy preference reads succeed but governance denies', async () => {
    const fixture = TestBed.createComponent(OrganizationSettingsComponent);
    fixture.detectChanges();
    http.expectOne((request) => request.url.endsWith('/preferences')).flush(preferencesFixture());
    http
      .expectOne((request) => request.url.endsWith('/governance'))
      .flush({}, { status: 403, statusText: 'Forbidden' });
    http.expectOne((request) => request.url.endsWith('/teams')).flush({ teams: [] });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Account role alone');
  });
  it('stages policy controls and confirms a single versioned patch instead of saving on toggle', async () => {
    const fixture = TestBed.createComponent(OrganizationPoliciesComponent);
    fixture.detectChanges();
    flush();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('input[type=checkbox]')).toHaveLength(8);
    const toggle = fixture.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
    toggle.click();
    await fixture.whenStable();
    http.expectNone((request) => request.method === 'PATCH');
    button(fixture, 'Review and save policies').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=dialog]').textContent).toContain(
      'no longer be able to create jobs',
    );
    http.expectNone((request) => request.method === 'PATCH');
    button(fixture, 'Save policies').click();
    const patch = http.expectOne((request) => request.method === 'PATCH');
    expect(patch.request.body).toEqual({
      policies: { recruiterJobCreation: false },
      expectedVersion: 3,
    });
    const saved = governanceFixture(4);
    saved.policies.recruiterJobCreation = false;
    patch.flush(saved);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Organization policies saved');
  });
  it('clears settings when the signed-in identity changes and ignores late responses', async () => {
    const fixture = await settings();
    user.next(null);
    await fixture.whenStable();
    http.expectNone((request) => request.url.endsWith('/governance'));
    expect(fixture.nativeElement.querySelector('#name')).toBeNull();
  });
});
