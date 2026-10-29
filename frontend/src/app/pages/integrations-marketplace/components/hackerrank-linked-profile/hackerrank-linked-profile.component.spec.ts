import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HackerRankLinkedProfileComponent } from './hackerrank-linked-profile.component';
import { IntegrationsService } from '../../../../shared/services/integrations.service';

describe('HackerRankLinkedProfileComponent', () => {
  const profile = {
    provider: 'hackerrank',
    username: 'coder',
    profileUrl: 'https://www.hackerrank.com/profile/coder',
    ownershipVerified: false,
    evidenceKind: 'user-entered-link',
  };
  const service = {
    getHackerRankLinkedProfile: vi.fn(),
    saveHackerRankLinkedProfile: vi.fn(),
    removeHackerRankLinkedProfile: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    service.getHackerRankLinkedProfile.mockReturnValue(of({ linkedProfile: null }));
    service.saveHackerRankLinkedProfile.mockReturnValue(of({ linkedProfile: profile }));
    service.removeHackerRankLinkedProfile.mockReturnValue(of({ linkedProfile: null }));
    TestBed.configureTestingModule({
      imports: [HackerRankLinkedProfileComponent],
      providers: [{ provide: IntegrationsService, useValue: service }],
    });
  });
  function mount() {
    const fixture = TestBed.createComponent(HackerRankLinkedProfileComponent);
    fixture.detectChanges();
    return fixture;
  }
  it('labels ownership unverified and keeps the link separate from syncing and scoring', () => {
    const fixture = mount();
    expect(fixture.nativeElement.textContent).toContain('Ownership unverified');
    expect(fixture.nativeElement.textContent).toContain('no scoring impact');
    expect(fixture.nativeElement.querySelector('.sync-btn')).toBeNull();
    const comp = fixture.componentInstance;
    comp.input = ' https://www.hackerrank.com/profile/coder ';
    comp.save();
    fixture.detectChanges();
    expect(service.saveHackerRankLinkedProfile).toHaveBeenCalledWith(
      'https://www.hackerrank.com/profile/coder',
    );
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a');
    expect(link.href).toBe(profile.profileUrl);
    expect(link.rel).toBe('noopener noreferrer');
    expect(fixture.nativeElement.textContent).toContain(
      'Profile existence and ownership have not been checked',
    );
  });
  it('loads the saved reference and removes only the linked profile', () => {
    service.getHackerRankLinkedProfile.mockReturnValue(of({ linkedProfile: profile }));
    const fixture = mount();
    expect(fixture.componentInstance.input).toBe('coder');
    fixture.componentInstance.remove();
    fixture.detectChanges();
    expect(service.removeHackerRankLinkedProfile).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
  });
  it('rejects empty input and retains a previously saved link when save fails', () => {
    service.getHackerRankLinkedProfile.mockReturnValue(of({ linkedProfile: profile }));
    const fixture = mount();
    const comp = fixture.componentInstance;
    comp.input = ' ';
    comp.save();
    expect(service.saveHackerRankLinkedProfile).not.toHaveBeenCalled();
    comp.input = 'other';
    service.saveHackerRankLinkedProfile.mockReturnValue(
      throwError(() => ({ error: { message: 'Invalid profile URL.' } })),
    );
    comp.save();
    fixture.detectChanges();
    expect(comp.profile?.username).toBe('coder');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Invalid profile URL',
    );
    expect(comp.busy).toBe(false);
  });
});
