// 页面自带的矢量插画，仅作为空状态展示，不冒充模型生成结果。
export default function Pelican({ small = false }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 440 300"
      fill="none"
      aria-hidden="true"
      className={small ? 'pelican-small' : 'pelican-art'}
    >
      <circle cx="229" cy="143" r="112" fill="#eef1df" />
      <circle cx="342" cy="69" r="9" fill="#efd9b8" />
      <path
        d="M62 251h321M92 266h48m191-1h27M56 125h26m-13-13v26M358 176h17m-8-8v16"
        stroke="#c4cfc3"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <g stroke="#34594f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="135" cy="207" r="45" fill="#f9faf3" />
        <circle cx="305" cy="207" r="45" fill="#f9faf3" />
        <g stroke="#c4d0bd" strokeWidth="1.4">
          <path d="m135 162 0 90m-45-45h90m-77-32 64 64m0-64-64 64m202-77v90m-45-45h90m-77-32 64 64m0-64-64 64" />
        </g>
        <path
          d="m135 207 56-67 40 67H135l31-73m25 6h87l-47 67m74 0-30-92h-19"
          stroke="#418b7b"
          strokeWidth="5"
        />
        <path d="M178 133h27M268 113h-16" strokeWidth="6" />
        <circle cx="231" cy="207" r="9" fill="#f8faf1" />
        <path d="m231 207 18 13h12" />
      </g>
      <path
        d="M177 76c-9 12-13 33-11 54-22-6-36-16-43-32 3 30 24 60 63 66 30 5 52-8 58-32l-20-26-47-30Z"
        fill="#fffef7"
        stroke="#34594f"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M180 121c9 24 31 26 43 11-18 5-31-4-43-11Z" fill="#dfe6d6" />
      <path
        d="M223 134c-15-19-25-30-25-54 0-24 10-41 30-41 20 0 31 16 24 37-5 15-26 23-22 42l9 11"
        fill="#fffef7"
        stroke="#34594f"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m247 64 83 16-84 6c8-8 7-15 1-22Z"
        fill="#efa754"
        stroke="#34594f"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="m252 82 65-1c-20 25-57 32-72 11l7-10Z"
        fill="#f2c576"
        stroke="#34594f"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="237" cy="59" r="3.5" fill="#294b41" />
      <path
        d="m187 164 16 17 34 8-7 10m-28-21 14 19"
        stroke="#c58a47"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m206 110 25 18 28-10" stroke="#34594f" strokeWidth="3" strokeLinecap="round" />
      <path d="m197 91-15 9-15-9 15-3-6-14 21 17Z" fill="#d17b50" />
      <path
        d="m100 69 8-7 9 4m207 59 7-5 7 3"
        stroke="#8da398"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
