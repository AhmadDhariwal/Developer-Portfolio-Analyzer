import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactPageComponent } from './contact-page.component';

describe('ContactPageComponent', () => {
  let component: ContactPageComponent;
  let fixture: ComponentFixture<ContactPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders direct channels cleanly without internal code implementation notes', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('devinsight.ai.help@gmail.com');
    expect(el.textContent).not.toContain('dial pad');

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    component.openPrimaryContact();
    expect(openSpy).toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

