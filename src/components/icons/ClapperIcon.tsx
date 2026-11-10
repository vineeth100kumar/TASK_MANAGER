import React from 'react';

type Props = React.SVGProps<SVGSVGElement> & { size?: number };

// Clapperboard with its top arm in a hinged group (.clap-arm) so it can really
// clap. The hinge sits at the board's left edge; index.css rotates .clap-arm
// about (3,11). Matches lucide's clapperboard outline so it sits with the rest.
export default function ClapperIcon({ size = 24, className, ...rest }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <g className="clap-arm">
        <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z" />
        <path d="m12.296 3.464 3.02 3.956" />
        <path d="m6.18 5.276 3.1 3.899" />
      </g>
    </svg>
  );
}
