import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Navbar } from './navbar';

describe('Navbar', () => {
  let component: Navbar;
  let fixture: ComponentFixture<Navbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Navbar],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Navbar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('supports arrow navigation and Escape in workspace search', () => {
    component.suggestions = [
      { type: 'page', label: 'Skill Gap', route: '/app/skill-gap' },
      { type: 'page', label: 'Profile', route: '/app/profile' },
    ];
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(component.activeSuggestion).toBe(1);
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(component.activeSuggestion).toBe(0);
    expect(component.showSuggestions).toBe(true);
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.showSuggestions).toBe(false);
  });
});
