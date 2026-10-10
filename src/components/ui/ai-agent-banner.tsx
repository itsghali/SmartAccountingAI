import * as React from "react"
import { Bot, Sparkles, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface AIAgentBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  description: string
  capabilities?: string[]
}

export function AIAgentBanner({
  title,
  description,
  capabilities,
  className,
  ...props
}: AIAgentBannerProps) {
  return (
    <div 
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/40 bg-background/40 backdrop-blur-3xl shadow-2xl transition-all duration-500 hover:shadow-primary/10 group animate-in fade-in slide-in-from-bottom-4",
        className
      )}
      {...props}
    >
      {/* Shimmering Top Border */}
      <div className="absolute top-0 inset-x-0 h-px bg-linear-to-r from-transparent via-primary/50 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
      
      {/* Ethereal Glow Background */}
      <div className="absolute -inset-24 bg-linear-to-tr from-primary/10 via-secondary/5 to-transparent blur-3xl rounded-full opacity-50 pointer-events-none" />
      
      <div className="relative p-6 sm:p-8 flex flex-col md:flex-row gap-6 md:gap-8 items-start">
        
        {/* Icon Area */}
        <div className="shrink-0 relative">
          {/* Animated blurred backdrop for the icon */}
          <div className="absolute -inset-3 bg-linear-to-r from-primary to-secondary rounded-2xl blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-700" />
          
          <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-background/80 border border-primary/20 shadow-inner overflow-hidden">
            <div className="absolute inset-0 bg-linear-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <Sparkles className="absolute top-2 right-2 w-3 h-3 text-secondary animate-pulse" />
            <Bot className="w-8 h-8 text-primary transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-12" />
          </div>
        </div>
        
        {/* Text Area */}
        <div className="flex-1 space-y-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold uppercase tracking-wider mb-1">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              AI Agent Active
            </div>
            
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h3>
            
            <p className="text-muted-foreground text-sm leading-relaxed max-w-3xl">
              {description}
            </p>
          </div>

          {capabilities && capabilities.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {capabilities.map((cap, i) => (
                <div 
                  key={i} 
                  className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 bg-muted/40 hover:bg-muted/80 px-3 py-1.5 rounded-lg border border-border/50 transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-secondary" />
                  {cap}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
