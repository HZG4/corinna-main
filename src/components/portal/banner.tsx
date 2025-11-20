import Image from 'next/image'
import React from 'react'

export const PortalBanner = () => {
  return (
    <div className="w-full bg-muted flex justify-center py-5">
      <Image
        src="/images/logo.png"
        alt="LOGO"
        sizes="100vw"
        className="block dark:hidden"
        style={{
          width: '100px',
          height: 'auto',
        }}
        width={0}
        height={0}
      />
      <Image
        src="/images/logo-dark.png"
        alt="LOGO"
        sizes="100vw"
        className="hidden dark:block"
        style={{
          width: '100px',
          height: 'auto',
        }}
        width={0}
        height={0}
      />
    </div>
  )
}
