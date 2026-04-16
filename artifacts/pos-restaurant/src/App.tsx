import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/Layout";
import FrontOffice from "@/pages/front-office";
import OrdersPage from "@/pages/orders";
import BackOfficeIndex from "@/pages/backoffice/index";
import MenuPage from "@/pages/backoffice/menu";
import TablesPage from "@/pages/backoffice/tables";
import ReportsPage from "@/pages/backoffice/reports";
import PaymentsPage from "@/pages/backoffice/payments";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchInterval: 15000,
    },
  },
});

function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={FrontOffice} />
        <Route path="/orders" component={OrdersPage} />
        <Route path="/backoffice" component={BackOfficeIndex} />
        <Route path="/backoffice/menu" component={MenuPage} />
        <Route path="/backoffice/tables" component={TablesPage} />
        <Route path="/backoffice/reports" component={ReportsPage} />
        <Route path="/backoffice/payments" component={PaymentsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
