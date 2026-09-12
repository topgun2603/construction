import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessagePerson, SiteMessage } from '@/lib/api-types';

const postSiteMessage = vi.fn(async () => ({ ok: true as const, data: undefined }));
const deleteSiteMessage = vi.fn(async () => ({ ok: true as const, data: undefined }));
const markMessagesRead = vi.fn(async () => ({ ok: true as const, data: undefined }));

vi.mock('@/lib/actions', () => ({
  postSiteMessage: (...args: unknown[]) => postSiteMessage(...(args as [])),
  deleteSiteMessage: (...args: unknown[]) => deleteSiteMessage(...(args as [])),
  markMessagesRead: (...args: unknown[]) => markMessagesRead(...(args as [])),
  presignUpload: vi.fn(),
}));

import { SiteConversation } from './site-conversation';

function message(over: Partial<SiteMessage> = {}): SiteMessage {
  return {
    id: 'm1',
    body: 'Is the tile sample up?',
    audience: 'everyone',
    created_at: new Date().toISOString(),
    author: { id: 'u-client', name: 'Vikram Shah', role: 'client' },
    recipient: null,
    mine: false,
    can_delete: false,
    read_by: [],
    attachments: [],
    ...over,
  };
}

const people: MessagePerson[] = [
  { id: 'u-owner', name: 'Gowtham Kumar', role: 'owner' },
  { id: 'u-super', name: 'Ramesh Iyer', role: 'site_supervisor' },
];

function draw(props: Partial<Parameters<typeof SiteConversation>[0]> = {}) {
  return render(
    <SiteConversation
      projectId="p1"
      messages={[]}
      recipients={people}
      canPost
      canWriteInternal={false}
      {...props}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());

/*
 * The audience a message goes to is the whole feature, and getting it wrong is not a cosmetic bug:
 * it is a builder's note about a client delivered to that client. These assert the gating, not the
 * styling.
 */
describe('who a message can be addressed to', () => {
  it('never offers a team note to someone without the permission', () => {
    draw({ canWriteInternal: false });
    expect(screen.queryByRole('button', { name: /team only/i })).not.toBeInTheDocument();
  });

  it('offers it to someone who has it', () => {
    draw({ canWriteInternal: true });
    expect(screen.getByRole('button', { name: /team only/i })).toBeInTheDocument();
  });

  it('offers writing to one person, which needs no special permission', () => {
    // A client may write privately to their builder; `messages.internal` is not what gates this.
    draw({ canWriteInternal: false });
    expect(screen.getByRole('button', { name: /one person/i })).toBeInTheDocument();
  });

  it('does not offer it when there is nobody to write to', () => {
    draw({ recipients: [] });
    expect(screen.queryByRole('button', { name: /one person/i })).not.toBeInTheDocument();
  });

  it('hides the composer entirely from a reader who cannot post', () => {
    draw({ canPost: false });
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /everyone/i })).not.toBeInTheDocument();
  });
});

describe('how a message is labelled once it is in the thread', () => {
  it('marks a team note unmistakably, so it cannot be read as public', () => {
    draw({ messages: [message({ audience: 'team', body: 'Quote the variation.' })] });
    expect(screen.getByText(/team only — the client cannot see this/i)).toBeInTheDocument();
  });

  it('names the one person a private message went to, on the sender s own copy', () => {
    draw({
      messages: [
        message({
          audience: 'direct',
          mine: true,
          recipient: { id: 'u-super', name: 'Ramesh Iyer', role: 'site_supervisor' },
        }),
      ],
    });
    expect(screen.getByText(/private to ramesh iyer/i)).toBeInTheDocument();
  });

  it('tells the recipient it was only for them', () => {
    draw({
      messages: [
        message({
          audience: 'direct',
          mine: false,
          recipient: { id: 'me', name: 'Me', role: 'owner' },
        }),
      ],
    });
    expect(screen.getByText(/private — sent only to you/i)).toBeInTheDocument();
  });

  it('says nothing about audience on an ordinary message', () => {
    draw({ messages: [message()] });
    expect(screen.queryByText(/team only/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private/i)).not.toBeInTheDocument();
  });
});

describe('read receipts', () => {
  it('shows sent, not read, until somebody has read it', () => {
    draw({ messages: [message({ mine: true, read_by: [] })] });
    expect(screen.getByTitle(/sent — not read yet/i)).toBeInTheDocument();
  });

  it('names the reader when there is one', () => {
    draw({ messages: [message({ mine: true, read_by: [{ id: 'u1', name: 'Vikram Shah' }] })] });
    expect(screen.getByText('Read by Vikram Shah')).toBeInTheDocument();
  });

  it('counts them when there are several', () => {
    draw({
      messages: [
        message({
          mine: true,
          read_by: [
            { id: 'u1', name: 'Vikram Shah' },
            { id: 'u2', name: 'Anita Desai' },
          ],
        }),
      ],
    });
    expect(screen.getByText('Read by 2')).toBeInTheDocument();
  });

  it('never shows a receipt on somebody else s message', () => {
    // A receipt answers "has my message landed". Showing who read everybody else's turns it into a
    // team watching each other read.
    draw({ messages: [message({ mine: false, read_by: [{ id: 'u1', name: 'Vikram Shah' }] })] });
    expect(screen.queryByText(/read by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^sent$/i)).not.toBeInTheDocument();
  });
});

describe('taking a message back', () => {
  it('offers Remove only while the server still says it would work', () => {
    draw({ messages: [message({ mine: true, can_delete: true })] });
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('drops the control once the window has closed, rather than greying it out', () => {
    // A disabled button invites the click that explains a rule nothing can be done about by then.
    draw({ messages: [message({ mine: true, can_delete: false })] });
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('still shows the receipt on a message too old to take back', () => {
    draw({
      messages: [message({ mine: true, can_delete: false, read_by: [{ id: 'u1', name: 'Anita' }] })],
    });
    expect(screen.getByText('Read by Anita')).toBeInTheDocument();
  });
});

describe('attachments', () => {
  it('shows a photo as a photo', () => {
    draw({
      messages: [
        message({
          attachments: [
            {
              id: 'a1',
              content_type: 'image/jpeg',
              size_bytes: 2048,
              filename: null,
              caption: null,
              is_image: true,
              url: 'https://example.test/t.jpg',
              full_url: 'https://example.test/f.jpg',
            },
          ],
        }),
      ],
    });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.test/t.jpg');
  });

  it('shows a file by name and size, because there is nothing to look at', () => {
    draw({
      messages: [
        message({
          attachments: [
            {
              id: 'a2',
              content_type: 'application/pdf',
              size_bytes: 240 * 1024,
              filename: 'quote-revised-2.pdf',
              caption: null,
              is_image: false,
              url: 'https://example.test/q.pdf',
              full_url: 'https://example.test/q.pdf',
            },
          ],
        }),
      ],
    });
    const link = screen.getByRole('link', { name: /quote-revised-2\.pdf/i });
    expect(within(link).getByText('240 KB')).toBeInTheDocument();
  });
});

describe('opening the thread', () => {
  it('marks it read, so the other side is not told "not seen" about a message on screen', () => {
    draw({ messages: [message()] });
    expect(markMessagesRead).toHaveBeenCalledWith('p1');
  });
});
