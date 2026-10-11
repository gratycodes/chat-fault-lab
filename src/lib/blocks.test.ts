import { splitBlocks } from './blocks';

describe('splitBlocks', () => {
  it('splits paragraphs on blank lines', () => {
    expect(splitBlocks('a\nb\n\nc')).toEqual([
      { kind: 'text', text: 'a\nb' },
      { kind: 'text', text: 'c' },
    ]);
  });

  it('renders closed and open fences as code', () => {
    expect(splitBlocks('Hi\n```ts\nx\n```\nBye')).toEqual([
      { kind: 'text', text: 'Hi' },
      { kind: 'code', lang: 'ts', code: 'x', open: false },
      { kind: 'text', text: 'Bye' },
    ]);
    expect(splitBlocks('Hi\n```py\nprint(1)')).toEqual([
      { kind: 'text', text: 'Hi' },
      { kind: 'code', lang: 'py', code: 'print(1)', open: true },
    ]);
  });

  it('does not flash a half-arrived fence marker', () => {
    expect(splitBlocks('Hi\n``')).toEqual([{ kind: 'text', text: 'Hi' }]);
  });

  it('keeps markup as text', () => {
    expect(splitBlocks('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });

  it('only closes a fence with the same marker', () => {
    const b = splitBlocks('~~~\n```\ninside\n~~~');
    expect(b).toEqual([{ kind: 'code', lang: '', code: '```\ninside', open: false }]);
  });
});
