import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';

const viewport = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => viewport.isMobile }));

function State({ onRender }: { onRender?: (state: string) => void }) {
  const { state, openMobile } = useSidebar();
  onRender?.(state);
  return (
    <>
      <output aria-label="Desktop state">{state}</output>
      <output aria-label="Mobile state">{String(openMobile)}</output>
      <SidebarTrigger />
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  viewport.isMobile = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sidebar persistence', () => {
  it.each([true, false])('restores saved open=%s on the first render', (saved) => {
    localStorage.setItem('sidebar_state', String(saved));
    const onRender = vi.fn();
    render(
      <SidebarProvider defaultOpen={!saved}>
        <State onRender={onRender} />
      </SidebarProvider>,
    );

    const expected = saved ? 'expanded' : 'collapsed';
    expect(onRender.mock.calls.map(([state]) => state)).toEqual([expected]);
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent(expected);
  });

  it.each([true, false])('uses defaultOpen=%s without a saved preference', (defaultOpen) => {
    render(
      <SidebarProvider defaultOpen={defaultOpen}>
        <State />
      </SidebarProvider>,
    );
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent(
      defaultOpen ? 'expanded' : 'collapsed',
    );
    expect(localStorage.getItem('sidebar_state')).toBeNull();
  });

  it('ignores invalid saved values', () => {
    localStorage.setItem('sidebar_state', 'invalid');
    render(
      <SidebarProvider>
        <State />
      </SidebarProvider>,
    );
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('expanded');
  });

  it('saves both states through the trigger and keyboard shortcut across remounts', () => {
    const mount = () =>
      render(
        <SidebarProvider>
          <State />
        </SidebarProvider>,
      );
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(localStorage.getItem('sidebar_state')).toBe('false');
    first.unmount();

    const second = mount();
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('collapsed');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(localStorage.getItem('sidebar_state')).toBe('true');
    second.unmount();

    mount();
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('expanded');
  });

  it('falls back to the default when reading storage throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    render(
      <SidebarProvider defaultOpen={false}>
        <State />
      </SidebarProvider>,
    );
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('expanded');
  });

  it('keeps toggling when saving fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    render(
      <SidebarProvider>
        <State />
      </SidebarProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('collapsed');
  });

  it('lets a controlled open prop override the saved preference', () => {
    localStorage.setItem('sidebar_state', 'false');
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SidebarProvider open onOpenChange={onOpenChange}>
        <State />
      </SidebarProvider>,
    );
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('expanded');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('expanded');
    rerender(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <State />
      </SidebarProvider>,
    );
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('collapsed');
  });

  it('keeps the mobile drawer transient without changing the desktop preference', () => {
    viewport.isMobile = true;
    localStorage.setItem('sidebar_state', 'false');
    const mount = () =>
      render(
        <SidebarProvider>
          <State />
        </SidebarProvider>,
      );
    const first = mount();
    expect(screen.getByLabelText('Mobile state')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.getByLabelText('Mobile state')).toHaveTextContent('true');
    expect(localStorage.getItem('sidebar_state')).toBe('false');
    first.unmount();

    mount();
    expect(screen.getByLabelText('Mobile state')).toHaveTextContent('false');
    expect(screen.getByLabelText('Desktop state')).toHaveTextContent('collapsed');
  });
});
