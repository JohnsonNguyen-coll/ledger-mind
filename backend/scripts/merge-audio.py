import os, sys, subprocess
import imageio_ffmpeg

def merge():
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    video_path = os.path.join(base_dir, 'demo-recordings', 'Recording 2026-09-08 011918.mp4')
    
    # Check for possible audio names
    audio_candidates = [
        'voice.mp3', 'voice.wav', 'audio.mp3', 'audio.wav',
        'elevenlabs.mp3', 'elevenlabs.wav', 'adam.mp3', 'adam.wav'
    ]
    audio_path = None
    for cand in audio_candidates:
        p = os.path.join(base_dir, 'demo-recordings', cand)
        if os.path.exists(p):
            audio_path = p
            break
            
    if not audio_path and len(sys.argv) > 1:
        audio_path = sys.argv[1]
        
    if not audio_path or not os.path.exists(audio_path):
        print('Usage: python scripts/merge-audio.py [path_to_audio_file]')
        print('Or place voice.mp3 in demo-recordings/ folder.')
        sys.exit(1)
        
    output_path = os.path.join(base_dir, 'demo-recordings', 'alphamesh-final-submission.mp4')
    print(f'Merging:\nVideo: {video_path}\nAudio: {audio_path}\nOutput: {output_path}')
    
    # Merge audio with video, keeping video stream copy or reencoding cleanly
    cmd = [
        ffmpeg, '-y',
        '-i', video_path,
        '-i', audio_path,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        output_path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f'SUCCESS! Exported final video: {output_path} ({size_mb:.2f} MB)')
    else:
        print('FFmpeg error:', res.stderr)

if __name__ == '__main__':
    merge()
