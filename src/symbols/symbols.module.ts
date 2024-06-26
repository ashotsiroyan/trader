import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolsService } from './symbols.service';
import { SymbolsController } from './symbols.controller';
import { History } from './entities/history.entity';
import { Symbol } from './entities/symbol.entity';
import { Order } from './entities/order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Symbol, History, Order])],
  controllers: [SymbolsController],
  providers: [SymbolsService],
  exports: [SymbolsService],
})
export class SymbolsModule { }
