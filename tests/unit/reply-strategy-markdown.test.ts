import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMarkdownReplyStrategy } from "../../src/reply-strategy-markdown";
import * as sendService from "../../src/send-service";
import type { ReplyStrategyContext } from "../../src/reply-strategy";

vi.mock("../../src/send-service", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/send-service")>();
    return {
        ...actual,
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    };
});

const sendMessageMock = vi.mocked(sendService.sendMessage);

function buildCtx(overrides: Partial<ReplyStrategyContext> = {}): ReplyStrategyContext {
    return {
        config: { clientId: "id", clientSecret: "secret", messageType: "markdown" } as any,
        to: "user_1",
        sessionWebhook: "https://session.webhook",
        senderId: "sender_1",
        isDirect: true,
        accountId: "main",
        storePath: "/tmp/store.json",
        log: undefined,
        deliverMedia: vi.fn(),
        ...overrides,
    };
}

describe("reply-strategy-markdown", () => {
    beforeEach(() => {
        sendMessageMock.mockReset().mockResolvedValue({ ok: true });
    });

    it("getReplyOptions returns disableBlockStreaming=true and no callbacks", () => {
        const strategy = createMarkdownReplyStrategy(buildCtx());
        const opts = strategy.getReplyOptions();
        expect(opts.disableBlockStreaming).toBe(true);
        expect(opts.onPartialReply).toBeUndefined();
        expect(opts.onReasoningStream).toBeUndefined();
        expect(opts.onAssistantMessageStart).toBeUndefined();
    });

    it("deliver(final) sends text via sendMessage", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx());
        await strategy.deliver({ text: "hello world", mediaUrls: [], kind: "final" });
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(sendMessageMock.mock.calls[0][2]).toBe("hello world");
    });

    it("deliver(final) throws when sendMessage returns not ok", async () => {
        sendMessageMock.mockResolvedValueOnce({ ok: false, error: "send failed" });
        const strategy = createMarkdownReplyStrategy(buildCtx());
        await expect(
            strategy.deliver({ text: "hello", mediaUrls: [], kind: "final" }),
        ).rejects.toThrow("send failed");
    });

    it("deliver(block) is silently ignored", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx());
        await strategy.deliver({ text: "block content", mediaUrls: [], kind: "block" });
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("deliver(tool) is silently ignored", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx());
        await strategy.deliver({ text: "tool result", mediaUrls: [], kind: "tool" });
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("deliver with mediaUrls calls deliverMedia regardless of kind", async () => {
        const deliverMedia = vi.fn();
        const strategy = createMarkdownReplyStrategy(buildCtx({ deliverMedia }));
        await strategy.deliver({ text: undefined, mediaUrls: ["/tmp/img.png"], kind: "block" });
        expect(deliverMedia).toHaveBeenCalledWith(["/tmp/img.png"]);
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("deliver(final) with empty text does not call sendMessage", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx());
        await strategy.deliver({ text: "", mediaUrls: [], kind: "final" });
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("finalize and abort are no-ops", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx());
        await strategy.finalize();
        await strategy.abort(new Error("test"));
    });

    it("getFinalText returns the last delivered final text", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx());
        expect(strategy.getFinalText()).toBeUndefined();
        await strategy.deliver({ text: "answer", mediaUrls: [], kind: "final" });
        expect(strategy.getFinalText()).toBe("answer");
    });

    it("passes atUserId for group (isDirect=false)", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx({ isDirect: false }));
        await strategy.deliver({ text: "group reply", mediaUrls: [], kind: "final" });
        expect(sendMessageMock.mock.calls[0][3]).toMatchObject({
            atUserId: "sender_1",
        });
    });

    it("does not pass atUserId for direct message", async () => {
        const strategy = createMarkdownReplyStrategy(buildCtx({ isDirect: true }));
        await strategy.deliver({ text: "dm reply", mediaUrls: [], kind: "final" });
        expect(sendMessageMock.mock.calls[0][3]?.atUserId).toBeNull();
    });
});
