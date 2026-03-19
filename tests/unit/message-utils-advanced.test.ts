import { describe, expect, it } from 'vitest';
import { extractMessageContent } from '../../src/message-utils';

describe('message-utils advanced extraction', () => {
    it('extracts picture/audio/video/file payloads', () => {
        expect(extractMessageContent({ msgtype: 'picture', content: { downloadCode: 'd1' } } as any)).toEqual(
            expect.objectContaining({ text: '<media:image>', mediaPath: 'd1', mediaType: 'image' })
        );

        expect(extractMessageContent({ msgtype: 'audio', content: { recognition: '语音识别', downloadCode: 'd2' } } as any)).toEqual(
            expect.objectContaining({ text: '语音识别', mediaPath: 'd2', mediaType: 'audio' })
        );

        expect(extractMessageContent({ msgtype: 'video', content: { downloadCode: 'd3' } } as any)).toEqual(
            expect.objectContaining({ text: '<media:video>', mediaPath: 'd3', mediaType: 'video' })
        );

        expect(extractMessageContent({ msgtype: 'file', content: { downloadCode: 'd4', fileName: 'a.pdf' } } as any)).toEqual(
            expect.objectContaining({ text: '<media:file> (a.pdf)', mediaPath: 'd4', mediaType: 'file' })
        );
    });

    it('extracts legacy quoteMessage msgId without injecting quote text', () => {
        const legacy = extractMessageContent({
            msgtype: 'text',
            text: { content: '当前消息' },
            quoteMessage: { msgId: 'legacy_quote_1', text: { content: '旧引用' } },
        } as any);

        const modern = extractMessageContent({
            msgtype: 'text',
            text: { content: '当前消息' },
            content: { quoteContent: '新引用' },
        } as any);

        expect(legacy.text).toBe('当前消息');
        expect(legacy.quoted?.msgId).toBe('legacy_quote_1');
        expect(modern.text).toBe('当前消息');
        expect(modern.quoted).toBeUndefined();
    });

    it('does not expose an empty quoted object when replied text has no usable metadata', () => {
        const result = extractMessageContent({
            msgtype: 'text',
            text: {
                content: '当前消息',
                isReplyMsg: true,
                repliedMsg: {
                    content: { text: '旧引用正文' },
                },
            },
        } as any);

        expect(result.text).toBe('当前消息');
        expect(result.quoted).toBeUndefined();
    });

    it('falls back for unknown msgtype', () => {
        const result = extractMessageContent({ msgtype: 'unknownType', text: { content: '' } } as any);
        expect(result.text).toBe('[unknownType消息]');
    });
});
