'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    type TooltipProps,
} from '@/components/animate-ui/components/animate/tooltip';
import { cn } from '@/lib/utils';

type OverflowTooltipTextProps = {
    text: string;
    as?: 'span' | 'h3';
    className?: string;
    tooltipClassName?: string;
    side?: TooltipProps['side'];
    sideOffset?: TooltipProps['sideOffset'];
    align?: TooltipProps['align'];
    alignOffset?: TooltipProps['alignOffset'];
};

export function OverflowTooltipText({
    text,
    as = 'span',
    className,
    tooltipClassName,
    side,
    sideOffset,
    align,
    alignOffset,
}: OverflowTooltipTextProps) {
    const elementRef = useRef<HTMLElement | null>(null);
    const [measureTarget, setMeasureTarget] = useState<HTMLElement | null>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);

    const setTextElement = useCallback((node: HTMLElement | null) => {
        elementRef.current = node;
        setMeasureTarget(node);
    }, []);

    const measureOverflow = useCallback(() => {
        const element = elementRef.current;

        if (!element) {
            setIsOverflowing(false);
            return;
        }

        const nextIsOverflowing =
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1;

        setIsOverflowing((previous) => previous === nextIsOverflowing ? previous : nextIsOverflowing);
    }, []);

    useLayoutEffect(() => {
        if (!measureTarget) return;

        const frame = window.requestAnimationFrame(measureOverflow);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureOverflow);

        observer?.observe(measureTarget);
        window.addEventListener('resize', measureOverflow);

        return () => {
            window.cancelAnimationFrame(frame);
            observer?.disconnect();
            window.removeEventListener('resize', measureOverflow);
        };
    }, [measureOverflow, measureTarget, text]);

    const textClassName = cn('block min-w-0 truncate', className);
    const contentClassName = cn('max-w-[min(28rem,80vw)]', tooltipClassName);
    const textElement = as === 'h3' ? (
        <h3 ref={setTextElement} className={textClassName}>{text}</h3>
    ) : (
        <span ref={setTextElement} className={textClassName}>{text}</span>
    );

    if (!isOverflowing) return textElement;

    return (
        <Tooltip side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset}>
            <TooltipTrigger asChild>{textElement}</TooltipTrigger>
            <TooltipContent className={contentClassName}>{text}</TooltipContent>
        </Tooltip>
    );
}
