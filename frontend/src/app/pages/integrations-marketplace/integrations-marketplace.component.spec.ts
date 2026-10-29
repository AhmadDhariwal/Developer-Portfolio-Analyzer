import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { IntegrationsMarketplaceComponent } from './integrations-marketplace.component';
import {
  IntegrationsService,
  IntegrationMarketplaceItem,
} from '../../shared/services/integrations.service';

const mockIntegrations: IntegrationMarketplaceItem[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description: 'Sync repositories, contribution activity, and language signals.',
    category: 'Code Hosting',
    authMode: 'oauth2',
    status: 'connected',
    externalUsername: 'testdev',
    lastSyncedAt: '2026-10-26T10:00:00.000Z',
  },
  {
    provider: 'leetcode',
    name: 'LeetCode',
    description: 'Track coding challenge consistency and difficulty progress.',
    category: 'Practice Platform',
    authMode: 'manual',
    status: 'disconnected',
    externalUsername: '',
    lastSyncedAt: null,
  },
  {
    provider: 'linkedin',
    name: 'LinkedIn',
    description: 'Import headline, endorsements, and networking signals.',
    category: 'Professional Network',
    authMode: 'oauth2',
    status: 'disconnected',
    externalUsername: '',
    lastSyncedAt: null,
  },
  {
    provider: 'stackoverflow',
    name: 'Stack Overflow',
    description: 'Fetch reputation, badges, and top tags.',
    category: 'Developer Community',
    authMode: 'manual',
    status: 'disconnected',
    externalUsername: '',
    lastSyncedAt: null,
  },
];

describe('IntegrationsMarketplaceComponent', () => {
  const serviceMock = {
    getMarketplace: vi.fn(),
    getInsights: vi.fn(),
    startOAuth: vi.fn(),
    oauthCallback: vi.fn(),
    manualConnect: vi.fn(),
    ingest: vi.fn(),
    syncNow: vi.fn(),
    disconnect: vi.fn(),
    getHackerRankLinkedProfile: vi.fn(),
    getKaggleLinkedProfile: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    serviceMock.getHackerRankLinkedProfile.mockReturnValue(of({ linkedProfile: null }));
    serviceMock.getKaggleLinkedProfile.mockReturnValue(of({ linkedProfile: null }));
    serviceMock.getMarketplace.mockReturnValue(of({ integrations: mockIntegrations }));
    serviceMock.getInsights.mockReturnValue(
      of({
        integrationScore: 78,
        providers: [],
        mergedSkills: ['JavaScript', 'TypeScript', 'Node.js'],
      }),
    );
    serviceMock.syncNow.mockReturnValue(of({ success: true }));
    serviceMock.manualConnect.mockReturnValue(of({ success: true }));
    serviceMock.disconnect.mockReturnValue(of({ success: true }));

    TestBed.configureTestingModule({
      imports: [IntegrationsMarketplaceComponent],
      providers: [provideRouter([]), { provide: IntegrationsService, useValue: serviceMock }],
    });
  });

  function mount() {
    const fixture = TestBed.createComponent(IntegrationsMarketplaceComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the same rendered nodes and request counts during ordinary change detection', () => {
    const fixture = mount();
    const cards = [...fixture.nativeElement.querySelectorAll('.integration-card')];
    for (let i = 0; i < 5; i++) fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('.integration-card')]).toEqual(cards);
    expect(serviceMock.getMarketplace).toHaveBeenCalledTimes(1);
    expect(serviceMock.getInsights).toHaveBeenCalledTimes(1);
    expect(serviceMock.syncNow).not.toHaveBeenCalled();
    expect(serviceMock.manualConnect).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('header.page-head')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('nav.filter-bar')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.market-grid > article').length).toBe(4);
  });

  it('routes header search, clear, categories and terminal controls through parent state', async () => {
    const fixture = mount();
    const root: HTMLElement = fixture.nativeElement;
    const search = root.querySelector<HTMLInputElement>('.search-input')!;
    search.value = 'leetcode';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.searchQuery).toBe('leetcode');
    expect(root.querySelectorAll('.integration-card').length).toBe(1);
    root.querySelector<HTMLButtonElement>('.search-clear')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.searchQuery).toBe('');
    const connected = [...root.querySelectorAll<HTMLButtonElement>('.tab-btn')].find((el) =>
      el.textContent?.includes('Connected'),
    )!;
    connected.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.activeCategory).toBe('connected');
    expect(root.querySelectorAll('.integration-card').length).toBe(1);
    root.querySelector<HTMLButtonElement>('.btn-ghost-terminal')!.click();
    fixture.detectChanges();
    expect(root.querySelector('section.terminal-drawer')).not.toBeNull();
    fixture.componentInstance.loadMarketplace();
    fixture.detectChanges();
    expect(root.querySelectorAll('.log-line').length).toBe(2);
    root.querySelector<HTMLButtonElement>('.terminal-close')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isTerminalOpen).toBe(false);
  });

  it('retains manual input ownership and emits one Connect and Sync request from a card', async () => {
    const pending = new Subject<any>();
    serviceMock.manualConnect.mockReturnValue(pending);
    const fixture = mount();
    const root: HTMLElement = fixture.nativeElement;
    const input = root.querySelector<HTMLInputElement>('#input-leetcode')!;
    input.value = '  fixture-handle  ';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.manualUsername.leetcode).toBe('  fixture-handle  ');
    const card = input.closest('article')!;
    card.querySelector<HTMLButtonElement>('.connect-btn')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(serviceMock.manualConnect).toHaveBeenCalledExactlyOnceWith(
      'leetcode',
      'fixture-handle',
      '',
    );
    expect(input.disabled).toBe(true);
    expect(card.textContent).toContain('Connecting + Syncing…');
    pending.next({ success: true });
    pending.complete();
    fixture.detectChanges();
    expect(serviceMock.syncNow).toHaveBeenCalledExactlyOnceWith('leetcode');
    expect(serviceMock.getMarketplace).toHaveBeenCalledTimes(2);
    expect(serviceMock.getInsights).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.manualUsername.leetcode).toBe('  fixture-handle  ');
  });

  it('routes provider Sync and Disconnect buttons without duplicated calls', () => {
    const fixture = mount();
    const root: HTMLElement = fixture.nativeElement;
    root.querySelector<HTMLButtonElement>('.sync-btn')!.click();
    fixture.detectChanges();
    expect(serviceMock.syncNow).toHaveBeenCalledExactlyOnceWith('github');
    root.querySelector<HTMLButtonElement>('.disconnect-btn')!.click();
    fixture.detectChanges();
    expect(serviceMock.disconnect).toHaveBeenCalledExactlyOnceWith('github');
    expect(serviceMock.getMarketplace).toHaveBeenCalledTimes(3);
    expect(serviceMock.getInsights).toHaveBeenCalledTimes(3);
  });

  it('does not advertise unmeasured score lifts, latency, TLS status or verified LinkedIn names', () => {
    const fixture = mount();
    const text = fixture.nativeElement.textContent;
    for (const unsupported of [
      '+15%',
      '+18%',
      '+320',
      '12ms',
      'TLS 1.3',
      'Verified name & email',
      'Zero credential storage',
    ]) {
      expect(text).not.toContain(unsupported);
    }
    expect(text).toContain('Not measured');
    expect(text).toContain('Name and optional email claims');
    expect(
      fixture.componentInstance.terminalLogs.some((row) =>
        row.message.includes('Monitoring supported platform connector interfaces'),
      ),
    ).toBe(false);
  });

  it('shows real pending sync state and restores controls after a backend error', () => {
    const pending = new Subject<any>();
    serviceMock.syncNow.mockReturnValue(pending);
    const fixture = mount();
    fixture.nativeElement.querySelector('.sync-all-btn').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Syncing All…');
    expect(fixture.nativeElement.querySelector('.sync-all-btn').disabled).toBe(true);
    pending.error({ error: { message: 'Integration controls temporarily unavailable.' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Integration controls temporarily unavailable.',
    );
    expect(fixture.componentInstance.syncAllLoading).toBe(false);
    expect(fixture.nativeElement.querySelector('.sync-all-btn').disabled).toBe(false);
  });

  it('creates the component and loads initial telemetry and marketplace items', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;
    expect(comp).toBeTruthy();
    expect(comp.integrations.length).toBe(4);
    expect(comp.connectedCount).toBe(1);
    expect(comp.disconnectedCount).toBe(3);
    expect(comp.integrationScore).toBe(78);
    expect(comp.getScoreHealthLabel(78)).toBe('Optimal');
  });

  it('filters integrations by active category tab', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    // Default 'all'
    expect(comp.displayedIntegrations.length).toBe(4);

    // 'connected'
    comp.activeCategory = 'connected';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].provider).toBe('github');

    // 'algo'
    comp.activeCategory = 'algo';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].provider).toBe('leetcode');

    // 'community'
    comp.activeCategory = 'community';
    expect(comp.displayedIntegrations.length).toBe(2);
  });

  it('filters integrations by search query across name and description', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    comp.searchQuery = 'LeetCode';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].name).toBe('LeetCode');

    comp.searchQuery = 'language signals';
    expect(comp.displayedIntegrations.length).toBe(1);
    expect(comp.displayedIntegrations[0].provider).toBe('github');

    comp.searchQuery = 'non-existent-keyword';
    expect(comp.displayedIntegrations.length).toBe(0);
  });

  it('triggers broadcast syncAll and refreshes telemetry', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    comp.syncAll();
    expect(serviceMock.syncNow).toHaveBeenCalled();
    expect(serviceMock.getMarketplace).toHaveBeenCalledTimes(2);
    expect(serviceMock.getInsights).toHaveBeenCalledTimes(2);
  });

  it('validates manual username requirement before connecting', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    const leetcodeItem = comp.integrations.find((item) => item.provider === 'leetcode')!;
    comp.manualUsername['leetcode'] = '';
    comp.manualConnect(leetcodeItem);

    expect(comp.errorMessage).toContain('LeetCode: LeetCode Username is required.');
    expect(serviceMock.manualConnect).not.toHaveBeenCalled();

    comp.manualUsername['leetcode'] = 'leetcode_hero';
    comp.manualConnect(leetcodeItem);
    expect(serviceMock.manualConnect).toHaveBeenCalledWith('leetcode', 'leetcode_hero', '');
  });

  it('disconnects a connected provider properly', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    const githubItem = comp.integrations.find((item) => item.provider === 'github')!;
    comp.disconnect(githubItem);

    expect(serviceMock.disconnect).toHaveBeenCalledWith('github');
  });

  it('retires HackerRank active card while retaining disconnect, and supports independent Dev.to input', () => {
    const items: IntegrationMarketplaceItem[] = [
      { ...mockIntegrations[1], provider: 'kaggle', name: 'Kaggle' },
      { ...mockIntegrations[0], provider: 'hackerrank', name: 'HackerRank', authMode: 'manual' },
      { ...mockIntegrations[1], provider: 'devblogs', name: 'Dev.to' },
    ];
    serviceMock.getMarketplace.mockReturnValue(of({ integrations: items }));
    const fixture = mount();
    const comp = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;

    // HackerRank is retired from active marketplace cards and prominent form
    expect(comp.integrations.some((i) => i.provider === 'hackerrank')).toBe(false);
    expect(root.querySelector('app-hackerrank-linked-profile')).toBeNull();
    expect(root.querySelector('#input-hackerrank')).toBeNull();

    // Kaggle includes its fallback inside the card
    expect(root.querySelector('#input-kaggle')).toBeNull();
    expect(root.querySelector('app-kaggle-linked-profile')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('.connect-btn')?.disabled).toBe(true);

    // Dev.to input
    expect(root.querySelector('#input-devblogs')?.getAttribute('placeholder')).toBe(
      'devto@your-handle',
    );
    expect(root.textContent).not.toContain('Dev.to or Hashnode');
    expect(root.textContent?.match(/Unavailable/g)?.length).toBe(1);

    comp.connect(items[0]);
    comp.manualConnect(items[0]);
    expect(serviceMock.manualConnect).not.toHaveBeenCalled();

    comp.manualUsername.devblogs = 'devto@swyx';
    comp.manualConnect(items[2]);
    expect(serviceMock.manualConnect).toHaveBeenCalledWith('devblogs', 'devto@swyx', '');

    // Disconnecting a historical connection is safely supported
    comp.disconnect(items[1]);
    expect(serviceMock.disconnect).toHaveBeenCalledWith('hackerrank');
  });

  it('corrects LinkedIn descriptions to state OpenID claims without misleading endorsements', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;
    const linkedinItem = comp.integrations.find((item) => item.provider === 'linkedin')!;
    expect(linkedinItem.description).toContain('OpenID basic profile');
    expect(linkedinItem.description).toContain(
      'Endorsements and network analytics are unavailable',
    );
    expect(fixture.nativeElement.textContent).not.toContain('tenure and endorsements');
  });

  it('calculates category totals and platform counts dynamically', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;
    expect(comp.getCategoryTotal('code')).toBe(1);
    expect(comp.getCategoryTotal('algo')).toBe(1);
    expect(comp.getCategoryTotal('community')).toBe(2);
    expect(comp.getCategoryTotal('knowledge')).toBe(0);
    expect(comp.integrations.length).toBe(4);
    expect(comp.connectedCount).toBe(1);
  });

  it('offers Dev.to without active Hashnode configuration', () => {
    const item: IntegrationMarketplaceItem = {
      ...mockIntegrations[1],
      provider: 'devblogs',
      name: 'Dev.to',
      description: 'Observe up to 30 public Dev.to articles with devto@username.',
    };
    serviceMock.getMarketplace.mockReturnValue(of({ integrations: [item] }));
    const fixture = mount();
    const comp = fixture.componentInstance;
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).not.toContain('HASHNODE_PUBLICATION_HOST');
    expect(root.textContent).not.toContain('hashnode@username');
    comp.manualUsername.devblogs = 'devto@writer';
    comp.manualConnect(item);
    expect(serviceMock.manualConnect).toHaveBeenCalledWith('devblogs', 'devto@writer', '');
  });

  it('routes opaque OAuth state to LinkedIn instead of treating it as a provider', () => {
    serviceMock.oauthCallback.mockReturnValue(
      throwError(() => ({ error: { message: 'Acceptance fixture' } })),
    );
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          queryParamMap: convertToParamMap({ code: 'fixture-code', state: 'opaque-random-state' }),
        },
      },
    });
    mount();
    expect(serviceMock.oauthCallback).toHaveBeenCalledWith(
      'linkedin',
      'fixture-code',
      'opaque-random-state',
    );
  });

  it('toggles terminal drawer and maintains logs', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    expect(comp.isTerminalOpen).toBe(false);
    comp.toggleTerminal();
    expect(comp.isTerminalOpen).toBe(true);
    expect(comp.terminalLogs.length).toBeGreaterThan(0);
  });

  it('enables accepted Kaggle resources while clearly labeling unverified sample counts', () => {
    const item: IntegrationMarketplaceItem = {
      ...mockIntegrations[1],
      provider: 'kaggle',
      name: 'Kaggle Resources',
      available: true,
      status: 'connected',
      resourceSummary: { notebooks: 20, datasets: 19, ownershipVerified: false },
    };
    serviceMock.getMarketplace.mockReturnValue(of({ integrations: [item] }));
    const fixture = mount();
    const comp = fixture.componentInstance;
    expect(comp.isProviderUnavailable('kaggle')).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Public sample: 20 notebooks');
    expect(fixture.nativeElement.textContent).toContain('19 datasets');
    expect(fixture.nativeElement.querySelector('.sync-btn').disabled).toBe(false);
    comp.runIngestion('kaggle');
    expect(serviceMock.syncNow).toHaveBeenCalledWith('kaggle');
  });

  it('resets connecting state and reloads data when page is restored from bfcache on pageshow', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    comp.busyProvider = 'linkedin';
    comp.busyAction = 'connect';
    expect(comp.busyProvider).toBe('linkedin');

    comp.onPageShow({ persisted: true } as PageTransitionEvent);
    expect(comp.busyProvider).toBe('');
    expect(comp.busyAction).toBe('');
    expect(serviceMock.getMarketplace).toHaveBeenCalledTimes(2);
  });

  it('clears connecting state on pagehide, window focus, and document visibility change', () => {
    const fixture = mount();
    const comp = fixture.componentInstance;

    comp.busyProvider = 'linkedin';
    comp.busyAction = 'connect';
    comp.onPageHide();
    expect(comp.busyProvider).toBe('');
    expect(comp.busyAction).toBe('');

    comp.busyProvider = 'linkedin';
    comp.busyAction = 'connect';
    comp.onWindowFocusOrVisibility();
    expect(comp.busyProvider).toBe('');
    expect(comp.busyAction).toBe('');
  });

  it('handles OAuth error and cancellation query parameters, clearing busy state and URL parameters', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          queryParamMap: convertToParamMap({
            error: 'user_cancelled_authorize',
            error_description: 'The user cancelled authorization.',
          }),
        },
      },
    });
    const fixture = mount();
    const comp = fixture.componentInstance;

    expect(comp.busyProvider).toBe('');
    expect(comp.busyAction).toBe('');
    expect(comp.errorMessage).toBe('The user cancelled authorization.');
    expect(
      comp.terminalLogs.some((l) => l.message.includes('The user cancelled authorization.')),
    ).toBe(true);
  });

  it('handles backend callback failure query parameter', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          queryParamMap: convertToParamMap({ error: 'callback_failed' }),
        },
      },
    });
    const fixture = mount();
    const comp = fixture.componentInstance;

    expect(comp.busyProvider).toBe('');
    expect(comp.busyAction).toBe('');
    expect(comp.errorMessage).toBe('OAuth authentication failed.');
  });
});
