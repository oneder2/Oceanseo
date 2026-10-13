import { CalendarDays, ChefHat, Compass, Dumbbell, Grid2X2, Home, Hourglass, MapPin, Radar, Server, ShoppingBasket, Users } from "lucide-react";
import type { ModuleId } from "../modules/catalog";

export const toolIcons: Partial<Record<ModuleId, typeof Home>> = {
  goals: Compass, calendar: CalendarDays, countdowns: Hourglass, people: Users,
  infrastructure: Server, "work-monitor": Radar, "bead-studio": Grid2X2,
  "meal-planner": ChefHat, "shopping-list": ShoppingBasket, fitness: Dumbbell, travel: MapPin,
};
