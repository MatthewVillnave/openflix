# Post-M4 cancellation correction

This change is separately tested after the accepted M4 tag, not retroactively covered by that verdict.

An intentional grant stop still returns 204. A pending media request cancelled before response headers receives 410 with a fixed expired/cancelled message. A disconnected client receives no new response. If binary headers have already been sent, cancellation closes the transport; it does not append a JSON error or fabricate successful bytes. Subsequent grant requests return 410. Revocation and exactly scoped device/play-session cleanup remain immediate/best-effort upstream.

Transport diagnostics distinguish explicit AbortError/cancellation from TimeoutError deadlines and actual header/socket-idle timeouts. Genuine upstream timeouts return 504 before headers; other upstream failures retain their existing safe errors. The player ignores HLS/native error callbacks after its session has exited and destroys the HLS client without retrying a retired grant.

Deterministic tests include a real OpenFlix HTTP HLS segment held before upstream headers, stop/410/prompt socket closure/exactly one scoped cleanup, a genuine 12-second header deadline returning 504, and real socket-idle, signal deadline and intentional-abort controls after headers. Internal timeout defaults remain unchanged.
