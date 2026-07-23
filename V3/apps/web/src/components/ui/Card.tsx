import { useState, type ReactNode } from "react";

interface CardProps {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  imageAlt?: string;
  children?: ReactNode;
}

export function Card({ title, subtitle, imageUrl, imageAlt = "", children }: CardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showFallback = !imageUrl || imageFailed;

  return (
    <article className="content-card">
      <div className="card-image">
        {showFallback ? (
          <div className="image-fallback" role="img" aria-label={imageAlt || `${title} image unavailable`}>
            <span aria-hidden="true">PT</span>
            <small>Image unavailable</small>
          </div>
        ) : (
          <img src={imageUrl} alt={imageAlt} onError={() => setImageFailed(true)} />
        )}
      </div>
      <div className="card-body">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
        {children}
      </div>
    </article>
  );
}
