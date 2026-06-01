'use client';

import { useStatsDaily, type StatsDailyFormatted } from '@/api/endpoints/stats';
import { useMemo, useRef, useLayoutEffect, useState, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import dayjs from 'dayjs';

interface StatsDailyData {
    dateStr: string;
    isFuture: boolean;
    formatted: StatsDailyFormatted | null;
}

const ACTIVITY_LEVELS = [
    { min: 5000, level: 4 },
    { min: 2000, level: 3 },
    { min: 1000, level: 2 },
    { min: 1, level: 1 }
];

function getActivityLevel(value: number): number {
    if (value === 0) return 0;
    return ACTIVITY_LEVELS.find(level => value >= level.min)?.level || 1;
}

function getLevelColor(level: number) {
    if (level === 0) return 'var(--muted)';
    return `color-mix(in oklch, var(--primary) ${level * 25}%, var(--muted))`;
}

export function Activity() {
    const { data: statsDailyFormatted, isLoading } = useStatsDaily();
    const scrollRef = useRef<HTMLDivElement>(null);
    const t = useTranslations('home.activity');

    const [tooltip, setTooltip] = useState<{ day: StatsDailyData; x: number; y: number; visible: boolean } | null>(null);

    const days = useMemo(() => {
        if (!statsDailyFormatted) return [];
        const formattedMap = new Map(statsDailyFormatted.map(stat => [stat.date, stat]));

        const today = dayjs();
        const startDate = today.subtract(today.day() + 53 * 7, 'day');

        const result: StatsDailyData[] = [];

        for (let i = 0; i < 54 * 7; i++) {
            const currentDate = startDate.add(i, 'day');
            const dateStr = currentDate.format('YYYYMMDD');

            result.push({
                dateStr,
                isFuture: currentDate.isAfter(today, 'day'),
                formatted: formattedMap.get(dateStr) || null
            });
        }

        return result;
    }, [statsDailyFormatted]);

    const [maskImage, setMaskImage] = useState('none');

    const checkScroll = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        const isStart = scrollLeft <= 1;
        const isEnd = Math.abs(scrollWidth - clientWidth - scrollLeft) <= 1;

        if (isStart && isEnd) {
            setMaskImage('none');
        } else if (isStart) {
            setMaskImage('linear-gradient(to left, transparent, rgba(0,0,0,0) 10px, black 40px)');
        } else if (isEnd) {
            setMaskImage('linear-gradient(to right, transparent, rgba(0,0,0,0) 10px,black 40px)');
        } else {
            setMaskImage('linear-gradient(to right, transparent, rgba(0,0,0,0) 10px, black 40px, black calc(100% - 40px),  rgba(0,0,0,0) calc(100% - 10px), transparent)');
        }
    }, []);

    useLayoutEffect(() => {
        const scrollToRight = () => {
            if (scrollRef.current) {
                scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
                checkScroll();
            }
        };
        scrollToRight();
        window.addEventListener('resize', scrollToRight);
        return () => window.removeEventListener('resize', scrollToRight);
    }, [days, isLoading, checkScroll]);

    const legendLevels = [0, 1, 2, 3, 4];

    return (
        <div className="rounded-lg bg-card border-card-border border text-card-foreground custom-shadow">
            <div className="flex flex-col gap-5 p-4 xl:flex-row xl:items-start xl:gap-6">
                <div className="space-y-3 xl:w-56 xl:shrink-0">
                    <div className="space-y-1">
                        <div className="text-sm font-semibold text-foreground">{t('title')}</div>
                        <p className="text-xs leading-5 text-muted-foreground">{t('description')}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="shrink-0">{t('less')}</span>
                        <div className="flex items-center gap-1" aria-hidden="true">
                            {legendLevels.map((level) => (
                                <span
                                    key={level}
                                    className="h-2.5 w-2.5 rounded-sm border border-border/60"
                                    style={{ backgroundColor: getLevelColor(level) }}
                                />
                            ))}
                        </div>
                        <span className="shrink-0">{t('more')}</span>
                    </div>
                </div>

                <div className="min-w-0 flex-1">
                    <div
                        ref={scrollRef}
                        onScroll={checkScroll}
                        className="overflow-x-auto pb-1"
                        style={{ maskImage, WebkitMaskImage: maskImage }}
                    >
                        <div className="min-w-max">
                            <div
                                className="grid gap-1"
                                style={{
                                    gridTemplateColumns: 'repeat(54, 0.875rem)',
                                    gridTemplateRows: 'repeat(7, 0.875rem)',
                                    gridAutoFlow: 'column'
                                }}
                            >
                                {days.map((day) => {
                                    if (day.isFuture) {
                                        return <div key={day.dateStr} />;
                                    }

                                    const level = getActivityLevel(day.formatted?.request_count.raw ?? 0);

                                    return (
                                        <div
                                            key={day.dateStr}
                                            className="rounded-sm transition-all cursor-pointer hover:scale-150"
                                            onMouseEnter={(e) => {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                setTooltip({ day, x: rect.left + rect.width / 2, y: rect.top, visible: true });
                                            }}
                                            onMouseLeave={() => setTooltip(prev => prev ? { ...prev, visible: false } : null)}
                                            style={{ backgroundColor: getLevelColor(level) }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {tooltip && typeof document !== 'undefined' && createPortal(
                (() => {
                    const isLeft = tooltip.x < 200;
                    const isRight = tooltip.x > window.innerWidth - 200;
                    const isTop = tooltip.y < window.innerHeight / 2;
                    const tooltipDate = dayjs(tooltip.day.dateStr, 'YYYYMMDD');
                    const tooltipDateLabel = tooltipDate.isValid() ? tooltipDate.format('YYYY-MM-DD') : tooltip.day.dateStr;

                    let transform = 'translate(-50%, 15%)';
                    if (!isTop && !isLeft && !isRight) {
                        transform = 'translate(-50%, -105%)';
                    } else if (isTop && isLeft) {
                        transform = 'translate(10%, 15%)';
                    } else if (isTop && isRight) {
                        transform = 'translate(-110%, 15%)';
                    } else if (!isTop && isLeft) {
                        transform = 'translate(10%, -105%)';
                    } else if (!isTop && isRight) {
                        transform = 'translate(-110%, -105%)';
                    }

                    return (
                        <div
                            className={`fixed z-50 w-fit min-w-max text-sm bg-background text-foreground border rounded-lg p-3 transition-opacity duration-500 pointer-events-none ${tooltip.visible ? 'opacity-100' : 'opacity-0'}`}
                            style={{
                                left: tooltip.x,
                                top: tooltip.y,
                                transform
                            }}
                        >
                            <div className="space-y-2">
                                <p className="font-semibold text-foreground">{tooltipDateLabel}</p>
                                {tooltip.day.formatted ? (
                                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-center text-muted-foreground">
                                        {[
                                            { labelKey: 'requestCount', ...tooltip.day.formatted.request_count },
                                            { labelKey: 'waitTime', ...tooltip.day.formatted.wait_time },
                                            { labelKey: 'totalToken', ...tooltip.day.formatted.total_token },
                                            { labelKey: 'totalCost', ...tooltip.day.formatted.total_cost },
                                        ].map((item, index) => (
                                            <Fragment key={index}>
                                                <span className="wrap-break-word">{t(item.labelKey)}</span>
                                                <span className="text-foreground font-medium text-right">{item.formatted.value}{item.formatted.unit}</span>
                                            </Fragment>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-muted-foreground">{t('noData')}</p>
                                )}
                            </div>
                        </div>
                    );
                })(),
                document.body
            )}
        </div>
    );
}
