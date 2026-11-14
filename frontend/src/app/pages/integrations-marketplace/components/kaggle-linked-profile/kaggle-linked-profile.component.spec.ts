import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { KaggleLinkedProfileComponent } from './kaggle-linked-profile.component';
import { IntegrationsService } from '../../../../shared/services/integrations.service';

describe('KaggleLinkedProfileComponent', () => {
  it('keeps Kaggle links unverified and separate from connect, sync and scoring', () => {
    const profile = {
      provider: 'kaggle',
      username: 'coder',
      profileUrl: 'https://www.kaggle.com/coder',
      ownershipVerified: false,
      evidenceKind: 'user-entered-link',
    };
    const service = {
      getKaggleLinkedProfile: vi.fn(() => of({ linkedProfile: null })),
      saveKaggleLinkedProfile: vi.fn(() => of({ linkedProfile: profile })),
      removeKaggleLinkedProfile: vi.fn(() => of({ linkedProfile: null })),
    };
    TestBed.configureTestingModule({
      imports: [KaggleLinkedProfileComponent],
      providers: [{ provide: IntegrationsService, useValue: service }],
    });
    const fixture = TestBed.createComponent(KaggleLinkedProfileComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Ownership unverified');
    expect(fixture.nativeElement.textContent).toContain('no scoring impact');
    fixture.componentInstance.input = 'coder';
    fixture.componentInstance.save();
    fixture.detectChanges();
    expect(service.saveKaggleLinkedProfile).toHaveBeenCalledWith('coder');
    expect(fixture.nativeElement.querySelector('a').href).toBe(profile.profileUrl);
    expect(fixture.nativeElement.querySelector('.sync-btn')).toBeNull();
    fixture.componentInstance.remove();
    expect(service.removeKaggleLinkedProfile).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.profile).toBeNull();
  });
});
