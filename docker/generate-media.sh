#!/bin/sh
# Generated test patterns only; these build outputs never enter the source archive.
set -eu
mkdir -p /media
ffmpeg -v error -f lavfi -i testsrc2=size=320x180:rate=15 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 12 -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -c:a aac -ac 2 -movflags +faststart /media/movie.mp4
ffmpeg -v error -f lavfi -i testsrc2=size=320x180:rate=15 -f lavfi -i sine=frequency=660:sample_rate=48000 -t 12 -c:v libvpx -b:v 300k -c:a libopus -ac 2 /media/episode.webm
ffmpeg -v error -f lavfi -i sine=frequency=880:sample_rate=44100 -t 12 -c:a pcm_s16le /media/track.wav
