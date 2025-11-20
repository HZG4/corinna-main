import React from 'react'

type Props = {
  title: string
  value: number
  icon: JSX.Element
  sales?: boolean
}

const DashboardCard = ({ icon, title, value, sales }: Props) => {
  return (
    <div className="flex-1 min-w-[250px] rounded-lg flex flex-col gap-3 p-10 border border-border bg-cream dark:bg-muted">
      <div className="flex gap-3">
        {icon}
        <h2 className="font-bold text-xl">{title}</h2>
      </div>
      <p className="font-bold text-4xl">
        {sales && '$'}
        {value}
      </p>
    </div>
  )
}

export default DashboardCard
