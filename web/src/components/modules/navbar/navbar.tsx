"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { useNavStore, type NavItem } from "@/components/modules/navbar"
import { ROUTES } from "@/route/config"
import { usePreload } from "@/route/use-preload"
import { useTranslations } from "next-intl"
import Logo from "@/components/modules/logo"

type NavBarProps = {
    onNavigate?: () => void
}

const groups = [
    { label: "管理后台", ids: ["home", "channel", "router", "model", "log"] },
    { label: "账户", ids: ["token", "setting"] },
] as const

export function NavBar({ onNavigate }: NavBarProps) {
    const { activeItem, setActiveItem } = useNavStore()
    const { preload } = usePreload()
    const t = useTranslations("navbar")

    const handleNavigate = (id: string) => {
        setActiveItem(id as NavItem)
        onNavigate?.()
    }

    return (
        <aside className="flex h-full min-h-0 w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
                <Logo size={38} />
                <div className="min-w-0">
                    <div className="truncate text-lg font-bold tracking-tight">uni-router</div>
                    <div className="mt-0.5 inline-flex rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        Admin
                    </div>
                </div>
            </div>

            <nav aria-label="Main Navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                <div className="grid gap-5">
                    {groups.map((group) => (
                        <div key={group.label} className="grid gap-1">
                            <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
                            {group.ids.map((id) => {
                                const route = ROUTES.find((item) => item.id === id)
                                if (!route) return null
                                const isActive = activeItem === route.id
                                const label = t(route.id)
                                return (
                                    <motion.button
                                        key={route.id}
                                        type="button"
                                        aria-label={label}
                                        title={label}
                                        onClick={() => handleNavigate(route.id)}
                                        onMouseEnter={() => preload(route.id)}
                                        className={cn(
                                            "relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors",
                                            isActive
                                                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                        )}
                                        whileTap={{ scale: 0.98 }}
                                    >
                                        <route.icon className="size-4 shrink-0" strokeWidth={2} />
                                        <span className="truncate">{label}</span>
                                    </motion.button>
                                )
                            })}
                        </div>
                    ))}
                </div>
            </nav>
        </aside>
    )
}
