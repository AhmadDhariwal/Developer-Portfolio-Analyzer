import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { TermsOfServiceComponent } from './terms-of-service.component';

describe('TermsOfServiceComponent', () => {
  let fixture: ComponentFixture<TermsOfServiceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TermsOfServiceComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(TermsOfServiceComponent);
    fixture.detectChanges();
  });

  it('renders terms sections, quick navigation anchors, and public shell', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Terms of Service');
    expect(el.textContent).toContain('Human Review');
    expect(el.querySelectorAll('.pub-toc-link').length).toBe(4);
    expect(el.querySelector('app-public-subpage-shell')).toBeTruthy();
  });
});

