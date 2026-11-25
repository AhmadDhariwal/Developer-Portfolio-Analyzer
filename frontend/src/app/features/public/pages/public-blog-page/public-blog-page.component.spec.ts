import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { PublicBlogPageComponent } from './public-blog-page.component';

describe('PublicBlogPageComponent', () => {
  let component: PublicBlogPageComponent;
  let fixture: ComponentFixture<PublicBlogPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicBlogPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicBlogPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('filters articles by category and toggles takeaways', () => {
    expect(component.filteredPosts().length).toBe(3);
    component.selectCategory('Recruiting');
    fixture.detectChanges();
    expect(component.filteredPosts().length).toBe(1);
    expect(component.filteredPosts()[0].category).toBe('Recruiting');

    const postId = component.filteredPosts()[0].id;
    expect(component.expandedPostId()).toBe(postId);
    component.togglePostTakeaways(postId);
    expect(component.expandedPostId()).toBeNull();
  });
});

