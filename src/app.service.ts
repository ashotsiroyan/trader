import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { History } from './entities/history.entity';
import { Symbol } from './entities/symbol.entity';
import { CreateSymbolDto } from './dto/create-symbol.dto';

@Injectable()
export class AppService {
  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,

    @InjectRepository(Symbol)
    private symbolRepository: Repository<Symbol>,

    @InjectRepository(History)
    private historyRepository: Repository<History>
  ){ }
  
  async createSymbol(createSymbolDto: CreateSymbolDto){
    const { name, listingDate } = createSymbolDto;

    const symbol = await this.symbolRepository.save({
      name: name.toUpperCase() + "USDT",
      listingDate: new Date(listingDate + "+4:00")
    });

    const timeoutMS = symbol.listingDate.getTime() - new Date().getTime() - 1000;
    
    if(timeoutMS > 0)
      this.addTimeout(symbol.name, timeoutMS);

    return symbol;
  }

  private async setPrice(name: string){
    const { MEXC_HOST } = process.env;
    const symbol = await this.symbolRepository.findOneBy({ name });

    if(!symbol.isListed){
      let price = 0;

      while(price == 0) {
        const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
        const data = await response.json();
        
        price = data.price;

        if(price == 0)
          await this.delay(100);
      }

      symbol.isListed = true;
      symbol.priceOnStart = price;

      this.addTimeout(symbol.name, 1000 * 60);
    }else{
      const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${name}`);
      const data = await response.json();
      
      symbol.priceOnMinute = data.price;
    }

    await this.symbolRepository.save(symbol);

    return { success: true };
  }

  async restartTimeouts(){
    const symbols = await this.symbolRepository.findBy({ isListed: false });

    for(let symbol of symbols){
      const timeoutMS = symbol.listingDate.getTime() - new Date().getTime() - 1000;
      
      if(timeoutMS > 0)
        this.addTimeout(symbol.name, timeoutMS);
    }

    return { success: true }
  }

  async getStatistics(){
    const symbols = await this.symbolRepository.find({ where: { isFinished: true }, relations: { history: true } });
    const response = [];

    for(let i = 0; i < symbols.length; i++){
      let symbol = symbols[i];

      response.push({
        symbol: symbol.name,
        priceOnStart: symbol.priceOnStart,
        priceOnMinute: symbol.priceOnMinute
      });

      for(let j = 0; j < symbol.history.length; j++)
        response[i][j + 1] = symbol.history[j].price;
    }

    return response;
  }

  private addTimeout(name: string, milliseconds: number) {
    const callback = () => {
      this.setPrice(name);
    };

    if(this.schedulerRegistry.doesExist('timeout', name))
      this.schedulerRegistry.deleteTimeout(name);

    const timeout = setTimeout(callback, milliseconds);
    this.schedulerRegistry.addTimeout(name, timeout);
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  @Cron('0 * * * *')
  private async addPrices() {
    const { MEXC_HOST } = process.env;
    
    const symbols = await this.symbolRepository.find({ where: { isFinished: false, isListed: true } });

    for(let symbol of symbols){
      const response = await fetch(`${MEXC_HOST}/ticker/price?symbol=${symbol.name}`);
      const data = await response.json();
      
      await this.historyRepository.save({
        symbol,
        price: data.price
      });

      const { count } = await this.historyRepository
        .createQueryBuilder('history')
        .select('COUNT("symbolId") as "count"')
        .where('"symbolId" = ' + symbol.id)
        .groupBy('"symbolId"')
        .getRawOne();

      if(count >= 24){
        symbol.isFinished = true;
        await this.symbolRepository.save(symbol);
      }
    }
  }
}
