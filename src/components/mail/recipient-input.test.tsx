import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatRecipient, RecipientInput } from '@/components/mail/recipient-input';
import type { Contact } from '@/lib/gmail';

const ann: Contact = {
  name: 'Öberg, Ann',
  email: 'ann@example.com',
  source: 'google',
};
const bob: Contact = {
  name: 'Bob',
  email: 'bob@example.com',
  source: 'icloud',
};

function Field() {
  const [value, setValue] = useState('');
  return (
    <RecipientInput value={value} onChange={setValue} contacts={[ann, bob]} placeholder="To" />
  );
}

describe('RecipientInput', () => {
  it('does not start a new recipient at a comma inside an unfinished name', () => {
    render(<Field />);
    fireEvent.change(screen.getByPlaceholderText('To'), {
      target: { value: '"Somebody, bo' },
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('allows completing a bare address before it has been selected', () => {
    render(<Field />);
    const input = screen.getByPlaceholderText('To');
    fireEvent.change(input, { target: { value: ann.email } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('"Öberg, Ann" <ann@example.com>, ');
  });

  it('does not suggest an address already selected with a display name', () => {
    render(<Field />);
    fireEvent.change(screen.getByPlaceholderText('To'), {
      target: { value: '"Öberg, Ann" <ANN@example.com>, ann' },
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('preserves completed quoted recipients when selecting another contact', () => {
    render(<Field />);
    const input = screen.getByPlaceholderText('To');
    fireEvent.change(input, {
      target: { value: '"Öberg, Ann" <ann@example.com>, bo' },
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('"Öberg, Ann" <ann@example.com>, Bob <bob@example.com>, ');
  });
});

describe('formatRecipient', () => {
  it('quotes comment punctuation so it cannot hide the next recipient', () => {
    expect(formatRecipient({ ...ann, name: 'Ann (Sales' })).toBe('"Ann (Sales" <ann@example.com>');
  });

  it('escapes both backslashes and quotes inside quoted display names', () => {
    expect(formatRecipient({ ...ann, name: 'Ann \\ "A", Öberg' })).toBe(
      '"Ann \\\\ \\"A\\", Öberg" <ann@example.com>',
    );
  });
});
