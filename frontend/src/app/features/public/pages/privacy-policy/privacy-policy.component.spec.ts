import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrivacyPolicyComponent } from './privacy-policy.component';

describe('PrivacyPolicyComponent', () => {
  let fixture: ComponentFixture<PrivacyPolicyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrivacyPolicyComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PrivacyPolicyComponent);
    fixture.detectChanges();
  });

  it('renders trust policy sections, quick navigation anchors, and public shell', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Privacy Policy');
    expect(el.textContent).toContain('Scoped RBAC');
    expect(el.querySelectorAll('.pub-toc-link').length).toBe(4);
    expect(el.querySelector('app-public-subpage-shell')).toBeTruthy();
  });
});

