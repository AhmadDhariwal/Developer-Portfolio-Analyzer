import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiDocsPageComponent } from './api-docs-page.component';

describe('ApiDocsPageComponent', () => {
  let component: ApiDocsPageComponent;
  let fixture: ComponentFixture<ApiDocsPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ApiDocsPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ApiDocsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('switches API domain tabs and displays payload conventions', () => {
    expect(component.activeDomain().id).toBe('auth');
    component.selectDomain('intelligence');
    fixture.detectChanges();

    expect(component.activeDomain().id).toBe('intelligence');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Developer Intelligence');
    expect(el.textContent).toContain('skillGap');
  });
});

