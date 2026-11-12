type ExternalAvatarImageProps = { src: string | null; className?: string };

export default function ExternalAvatarImage({ src, className }: ExternalAvatarImageProps) {
  // Keep the provider's dynamic avatar URL unchanged; Next image optimization would require a remote-host allowlist.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src ?? undefined} alt="" className={className} loading="lazy" referrerPolicy="no-referrer" />;
}
