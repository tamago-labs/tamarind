// Video player component for displaying uploaded videos on the canvas.
// Uses HTML5 video element with controls for playback.

interface VideoPlayerProps {
  url: string
  width?: number
  height?: number
  className?: string
}

export function VideoPlayer({ url, width = 320, height = 240, className = '' }: VideoPlayerProps) {
  return (
    <video
      controls
      width={width}
      height={height}
      className={`rounded-md border border-gray-200 bg-black ${className}`}
      preload='metadata'
    >
      <source src={url} />
      Your browser does not support the video tag.
    </video>
  )
}
