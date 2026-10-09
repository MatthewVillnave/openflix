#!/bin/sh
# Pure generated test patterns. No household media; never part of source archives.
set -eu
mkdir -p /media/generated
ffmpeg -v error -f lavfi -i testsrc2=size=320x180:rate=15 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 18 -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -g 30 -c:a aac -ac 2 -movflags +faststart '/media/generated/Direct Fixture.mp4'
ffmpeg -v error -i '/media/generated/Direct Fixture.mp4' -c copy '/media/generated/Remux Fixture.mkv'
ffmpeg -v error -i '/media/generated/Direct Fixture.mp4' -c:v copy -c:a ac3 -ac 6 '/media/generated/Audio Conversion Fixture.mkv'
ffmpeg -v error -i '/media/generated/Direct Fixture.mp4' -c:v libx265 -preset ultrafast -x265-params pools=1:frame-threads=1:log-level=error -pix_fmt yuv420p -c:a copy '/media/generated/Video Conversion Fixture.mkv'

printf '1\n00:00:00,000 --> 00:00:17,000\nGenerated subtitle fixture\n' > /media/generated.srt
ffmpeg -v error -i '/media/generated/Direct Fixture.mp4' -i /media/generated.srt -map 0:v -map 0:a -map 1:0 -c:v copy -c:a copy -c:s srt '/media/generated/Subtitle Fixture.mkv'
rm /media/generated.srt
