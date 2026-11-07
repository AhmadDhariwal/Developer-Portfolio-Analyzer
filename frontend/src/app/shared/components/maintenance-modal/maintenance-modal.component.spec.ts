import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MaintenanceModalComponent } from './maintenance-modal.component';

describe('MaintenanceModalComponent', () => {
  let component: MaintenanceModalComponent;
  let fixture: ComponentFixture<MaintenanceModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MaintenanceModalComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(MaintenanceModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should emit close when close button is clicked', () => {
    fixture.detectChanges();
    let closed = false;
    component.close.subscribe(() => (closed = true));

    const btn = fixture.nativeElement.querySelector('app-ui-button button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();

    expect(closed).toBe(true);
  });
});
